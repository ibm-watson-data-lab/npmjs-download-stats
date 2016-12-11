//-------------------------------------------------------------------------------
// Copyright IBM Corp. 2016
//
// Licensed under the Apache License, Version 2.0 (the 'License');
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an 'AS IS' BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//-------------------------------------------------------------------------------

'use strict';

const async = require('async');
const debug = require('debug')('nps:init');
const debug_data = require('debug')('nps:data');

const Collector = require('./collector.js');

var configureMetaRepository = function(metaRepository, options, callback) {

	if(! metaRepository) {
		return callback('Parameter metaRepository is missing.');
	}

	options = options || {};

	const designDoc = {
						_id: '_design/metadata',
					    views: {
						    config: {
						      map: 'function (doc) {\n  if(doc._id === \'config\') {\n    emit(doc._id, 1);\n  }\n}'
						    }
					  	},
					  	language: 'javascript'
					  };

	const configDoc = {
						_id: 'config',
						packages: []
                      };

   	configDoc.start_year = options.start_year ||  new Date().getFullYear();                 

    async.series(
    				[
    					function(asyncCallback) {
							metaRepository.get(designDoc._id, 
											   function (err) {
											  		if(err)	{
														// create design document
														metaRepository.insert(designDoc, 
																			  designDoc._id,
																			  function (err) {																		  	
																			  		if(err)	 {
																			  			console.error('Could not create design document in repository database: ' + err);
																			  			return asyncCallback('Could not create design document in repository database: ' + err);	
																			  		}
																			  		else {
																			  			console.log('Created design document in the repository database.');
																						return asyncCallback();
																			  		}
																			  });											  			
											  		}
											  		else {
											  			return asyncCallback();
											  		}
											   });
    					},
    					function(asyncCallback) {
							metaRepository.get(configDoc._id, 
											   function (err) {
											  		if(err)	{
														// create config document
														metaRepository.insert(configDoc, 
																			  configDoc._id,
																			  function (err) {																		  	
																			  		if(err)	 {
																			  			console.error('Could not create configuration document in repository database: ' + err);
																			  			return asyncCallback('Could not create configuration document in repository database: ' + err);	
																			  		}
																			  		else {
																			  			console.log('Created configuration document in the repository database.');
																						return asyncCallback();
																			  		}
																			  });											  			
											  		}
											  		else {
											  			return asyncCallback();
											  		}

											   });
    					}    					
    				],
    				function(err) {
    					return callback(err);
    				}
    			);
};

/*
 * Initialize repository and load defaults
 * @param {Object} appEnv
 * @param {callback} initCallback
 */
var init = function(appEnv, initCallback) {

	//if(! process.env.SLACK_TOKEN) {
	//    debug(JSON.stringify(appEnv));
	//    return initCallback('Configuration error. Environment variable SLACK_TOKEN is not set.');
	//}


	// identify repository database; defaults to nps-cloudant unless overwritten by environment variable
	// COUCH_INSTANCE_NAME
	const couchDBServiceInstanceName = process.env.COUCH_INSTANCE_NAME || 'npmjs-cloudant';

	const couchDBCredentials = appEnv.getServiceCreds(couchDBServiceInstanceName);

	if(! couchDBCredentials) {
	    debug_data('appEnv: ' + JSON.stringify(appEnv));
	    return initCallback('Configuration error. No CouchDB/Cloudant instance named ' + couchDBServiceInstanceName + ' is bound to this service.');
	}
	else {
		console.log('CouchDB/Cloudant instance ' + couchDBServiceInstanceName + ' is bound to this service.');
		debug_data('couchDBCredentials: ' + JSON.stringify(couchDBCredentials));
	}

	// cloudant options:
	//  required: credentials
	var options = {url:couchDBCredentials.url};

	options.plugin = require('cachemachine')({paths: [
													  {path: '.*/npmjs-data/_design/stats/', ttl: 120}
													 ]});

	const repository = require('cloudant')(options);

	const dataRepositoryName = 'npmjs-data';
	const metaRepositoryName = 'npmjs-meta';

	async.parallel({
						data: function(asyncCallback) {
							const designDoc = {
											    _id: '_design/stats',
											    views: {
											     stats: {
											       map: 'function (doc) {  if(doc.type === \'stats\') {    if(doc.hasOwnProperty("package") && doc.hasOwnProperty("month") & doc.hasOwnProperty("total")) emit([doc.package, doc.month], doc.total); }}',
											       reduce: '_sum'	
											     },
											     packages: {
											       map: 'function (doc) {  if(doc.type === \'stats\') { emit(doc.package,1);}}',
											       reduce: '_count'	
											     }											     
											   },
											   language: 'javascript'
											  };
							repository.db.get(dataRepositoryName, 
										   	  function(err, body) {
												if(err) {
													// try to create the database
													console.log('Cannot get information about database "' + dataRepositoryName + '": ' + err);
													repository.db.create(dataRepositoryName, function(err) {
														if(err) {
															return asyncCallback('Cannot create database "' + dataRepositoryName + '": ' + err);
														}

														var dataRepository = repository.use(dataRepositoryName);
														// create design document
														dataRepository.insert(designDoc, 
																			  designDoc._id,
																			  function (err) {																		  	
																			  		if(err)	 {
																			  			console.error('Could not create design document in data repository database: ' + JSON.stringify(err));
																			  			return asyncCallback('Could not create design document in data repository database: ' + err);	
																			  		}
																			  		else {
																			  			console.log('Created design document in the data repository database.');
																						return asyncCallback(null, dataRepository);
																			  		}
																			  });											
													});
												}
												else {
													debug('data repository database stats: ' + JSON.stringify(body));
													var dataRepository = repository.use(dataRepositoryName);
													// make sure the design document exists
													dataRepository.get(designDoc._id, 
																	   function (err) {
																	   		if(err)	{
																	   			debug('Design document ' + designDoc._id + ' was not found: ' + err);
																				dataRepository.insert(designDoc, 
																									  designDoc._id,
																									  function (err) {																		  	
																									  		if(err)	 {
																									  			console.error('Could not create design document in data repository database: ' + err);
																									  			return asyncCallback('Could not create design document in data repository database: ' + err);	
																									  		}
																									  		else {
																									  			console.log('Created design document in the data repository database.');
																												return asyncCallback(null, dataRepository);
																									  		}
																									  });
																	   		}
																	   		else {
																	   			debug('Design document ' + designDoc._id + ' was found in the data repository database.');
																	   			return asyncCallback(null, dataRepository);
																	   		}
																	   });		
												}
								});
						},
						meta: function(asyncCallback) {

							repository.db.get(metaRepositoryName, 
										   function(err, body) {
												if(err) {
													// try to create the database
													console.log('Cannot get information about database "' + metaRepositoryName + '": ' + err);
													repository.db.create(metaRepositoryName, function(err) {
														if(err) {
															return asyncCallback('Cannot create database "' + metaRepositoryName + '": ' + err);
														}

														var metaRepository = repository.use(metaRepositoryName);

														configureMetaRepository(metaRepository, 
																			    null,
																			    function(err) {
																			    	if(err) {
																			    		metaRepository = null;
																			    	}
																			    	return (asyncCallback(err, metaRepository));
																			    });

													});
												}
												else {
													debug('metada repository database stats: ' + JSON.stringify(body));
													var metaRepository = repository.use(metaRepositoryName);

													configureMetaRepository(metaRepository, 
																		    null,
																		    function(err) {
																		    	if(err) {
																		    		metaRepository = null;
																		    	}
																		    	return (asyncCallback(err, metaRepository));
																		    });
												}
											});
						}
				   },
				   function(err, handles) {
				   		// async.parallel callback
						if(err) {
							// repository initialization failed
							return initCallback(err);
						}
						else {
							return initCallback(null, handles.data, handles.meta, new Collector(handles.data));
						}
					});
};

module.exports = init;
