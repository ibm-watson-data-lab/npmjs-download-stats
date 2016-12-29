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

const _ = require('lodash');
const async = require('async');
const rest = require('rest-facade');

const debug = require('debug')('npmjs:collect');
const debug_data = require('debug')('npmjs:collect:data');

function NPMJSCollector(repository) {
	this.dataRepository = repository;

	var options = {
  		headers: {
    		Authorization: 'Bearer token'
  		},
  		errorFormatter: {
    		name: 'error.title',
    		message: 'error.text',
  		}
	};

	this.npmjsClient = new rest.Client('https://api.npmjs.org/downloads/range/:dateRange/:packages', options);
	// initialize last data collection time
	this.lastcollection = null;
}

NPMJSCollector.prototype.getPackages = function(callback) {

	if(! this.dataRepository) {
		return callback('No data repository is defined.');
	}

	var options = {
					include_docs: false,
					group_level: 1
				  };

	this.dataRepository.view('stats', 
							 'packages',
							  options,
							  function(err, data) {
							  		if(err) {
							  			return callback(err);
							  		}
							  		var packages = [];	
							  		_.forEach(data.rows, 
							  				  function(row) {
							  				  	packages.push(row.key);
							  		});
							  		return callback(null, packages);
							  });
};

NPMJSCollector.prototype.collectYear = function(packages, year, callback) {

	var months = [1,2,3,4,5,6,7,8,9,10,11,12];
	async.eachLimit(months,
					2, 
		            function(month, innerCallback) {            	
						this.collectMonth(packages, year, month,innerCallback);
					}.bind(this),
					function(err) {
						return callback(err);
					});
};

/**
 * Removes the documents identified by docs.
 * @param docs - Object[]
 * @param docs._id document id
 * @param docs._rev document revision
 * @param callback
 *
 */
NPMJSCollector.prototype.purge = function(docs, callback) {
	if((docs) && (docs.length > 0)) {
		docs.forEach(function(doc) {
			doc._deleted = true;
		});
		this.dataRepository.bulk({docs: docs}, 
							  	 function(err, data) {
							  	 	debug('Purge request result: ' + JSON.stringify(data));
							  	 	return callback(err);
							  	 });
	}
	else {
		return callback();
	}
};

NPMJSCollector.prototype.collectMonth = function(packages, year, month, callback) {

	if(! this.dataRepository) {
		return callback('No data repository is defined.');
	}

	if((! packages) || (! year) || (! month)) {
		return callback(); // nothing to do
	}

	const currentdate = new Date().toISOString();
	const collectiondate = currentdate.substring(0,10);

	// check year/month parms
	if(currentdate.substring(0,7).localeCompare(year + '-' + month) < 0) {
		console.log('Ignoring request to collect download information for ' + year + '-' + month);
		return callback();	// no download statistics can be collected for future dates
	}

	if(! Array.isArray(packages)) {
		packages = [packages];
	}

	// update last data collection time
	this.lastcollection = currentdate;

	var dateRangeStart = new Date(year, month - 1,1).toISOString().substring(0,10);
	var dateRangeEnd =	new Date(year, month, 0).toISOString().substring(0,10);

	debug('Collecting download statistics for ' + packages.toString() + ' for date range ' + dateRangeStart + ' and ' + dateRangeEnd);

	// submit npmjs request
	// sample: https://api.npmjs.org/downloads/range/2016-01-01:2016-02-01/cloudant
	this.npmjsClient.getAll({ dateRange: dateRangeStart + ':' + dateRangeEnd , packages: packages},
						    function(err, data) {
						    	if(err) {
						    		return callback(err);
						    	}

						    	if(data.hasOwnProperty('error')) {
						    		if(data.error === 'no stats for this package for this range (0008)') {
						    			return callback(); // nothing to do; don't return an error
						    		}
						    		else {
						    			return callback(data.error);
						    		}
						    	}
						    	
						    	debug('Fetched download statistics. Err is ' + err);
						    	debug_data('Data: ' + JSON.stringify(data));

						    	// iterate through packages and create a stats doc for each
						    	var statsDocs = [];
						    	var root = null;
						    	var total = 0;
						    	_.forEach(packages, 
						    		      function(packageName) {
						    		      	debug('Checking for download information for package "' + packageName + '"');
						    		      	root = null;
						    		      	if(data.hasOwnProperty(packageName)) {
						    		      		root = data[packageName];	
						    		      	}
						    		      	else {
						    		      		if(data.hasOwnProperty('downloads')) {
						    		      			root = data;
						    		      		}
						    		      	}	
						    		      	if(root !== null) {
						    		      		debug('Found download information for package ' + packageName);
							    		      	total = 0;
							    		      	_.forEach(root.downloads, function(download) {
							    		      		total = total + download.downloads;
							    		      	});

												statsDocs.push({
							    								_id: root['package'] + '_' + root.start.substring(0, 7),
							    								type: 'stats',
							    								package: root['package'],
							    								collection_date: collectiondate,
							    								language: 'javascript',
							    								month: root.start.substring(0, 7),
							    								total: total,
							    								range: {
							    									start: root.start,
							    									end: root.end
							    								},
							    								data: root.downloads
							    						  		});						    		      		
						    		      	}
						    		      	else {
						    		      		debug('No download information is available for package ' + packageName);
						    		      	}
						    	});

						    	if(statsDocs.length > 0) {
						    		debug('Saving ' + statsDocs.length + ' download statistics documents.');
						    		// store stats documents in Cloudant
						    		this.dataRepository.bulk({docs:statsDocs},
						    								 function(err, data) {
						    								 	debug('Bulk save done. Error: ' + err);
						    								 	debug_data(data);
						    								 	return callback(err);
						    								 });
						    	}
						    	else {
						    		debug('No download statistics were found for ' + packages.toString() + ' for date range ' + dateRangeStart + ' and ' + dateRangeEnd);
						    		return callback();						    		
						    	}
						    }.bind(this));
};

/**
 * Collects the statistics for todolist
 * @param todolist
 * @param callback invoked when processing is finished; returns (err, data)
 */
NPMJSCollector.prototype.collect = function(todolist, callback) { 
	if(! todolist) {
		// nothing to do
		return callback();
	}
	// process TODO list
	async.eachLimit(Object.keys(todolist),
					1,
				    function(year, asyncCallbackYear) {
				  		async.eachLimit(
					  					Object.keys(todolist[year]),
					  					1,
								  		function(month, asyncCallbackMonth) {
											this.collectMonth(todolist[year][month], 
															  year, 
															  month,
										            	      function(err, data) {
										            	      	debug(data);
										    					return asyncCallbackMonth(err);
										                   	});					  		
								  		}.bind(this),
								  		function(err) {
								  			return asyncCallbackYear(err);
								  		});
				  	}.bind(this),
				  	function(err) {
						return callback(err);
				  	});
};


/**
 * Identifies when deployment numbers were last collected
 * @return String ISO8601 timestamp
 */
NPMJSCollector.prototype.getLastCollectionTime = function() {
	return this.lastcollection;
};

module.exports = NPMJSCollector;