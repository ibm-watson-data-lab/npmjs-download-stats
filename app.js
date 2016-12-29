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

const cfenv = require('cfenv');
const express = require('express');
const exphbs = require('express-handlebars');
const bodyParser = require('body-parser');
const path = require('path');
const SimpleDataVis = require('simple-data-vis');

// to enable debugging, set environment variable DEBUG to nps or *
const debug = require('debug')('npmjs');

const init = require('./lib/initialize.js');

/*
 * 
 * 
 * 
 * 
 * Service dependencies:
 *  Cloudant 
 * 
 * Environment variable dependencies:
 *
 *
 */

 	debug('debug is enabled.');

	var appEnv = cfenv.getAppEnv();

	// load service binding for repository database if running locally
	if(appEnv.isLocal) {
		try {
	  		appEnv = cfenv.getAppEnv({vcap: {services: require('./vcap_services.json')}});
		}
		catch(ex) { 
			// ignore 
		}
	}

	debug(JSON.stringify(appEnv));

	console.log('Service is initializing...');

	// initialize Cloudant repository and load defaults
	init(appEnv, function(err, dataRepository, metaRepository, collector, indexer, config) {

		//
		// dataRepository - cloudant handle for data database
		//

		if(err) {
			console.error('Service initialization failed: ' + err);
			process.exit(1);
		}


		var refresh = function() {
			config.getConfig(function(err, config) {
				if(err) {
					console.error('Error fetching service configuration: ' + err);
				}
				else {
					debug('Service configuration: ' + JSON.stringify(config));
					// asynchronously build index and collect missing statstics
					debug('Building index ...');
					indexer.buildIndex(function(err) {
						if(err) {
							console.error('Index build error: ' + err);
						}
						else {
							console.log('Index was built. Identifying stale or missing statistics ...');
							indexer.inspectIndex(config, 
												 function(err, 
												 		  todolist,
												 		  stalelist) {
												 	if(err) {
														console.error('Index inspection error: ' + err);						 		
												 	}
												 	else {
												 		console.log('Purging stale statistics ...');
												 		collector.purge(stalelist,
												 						function(err) {
												 			if(err) {
												 				// treat as non-fatal
												 				console.error('Error purging stale data: ' + err);
												 			}
															console.log('Collecting missing and stale statistics ... ');
															collector.collect(todolist,
																			  function(err, data) {
																			  		if(err) {
																			  			console.error('Statistics collector error: ' + JSON.stringify(err));
																			  		}
																			  		else {
																			  			console.log('Download statistics have been updated.');
																			  			debug('Statistics collection results: ' + JSON.stringify(data));
																			  		}
															});
												 		});
														
												 	}
												 });
						}
					});
				}
			});		
		};

		refresh();

		var app = express();
		app.use(bodyParser.urlencoded({extended: false}));
  		// use https://www.npmjs.com/package/express-handlebars as view engine
		app.engine('handlebars', exphbs({layoutsDir: 'public/layouts',
										 defaultLayout: 'main', 
			                             helpers: { 
			                             	json: function(object) { 
			                             		return JSON.stringify(object);}
			                             }}));
		app.set('view engine', 'handlebars');
		app.set('views', 'public');
		app.use(express.static(path.join(__dirname, 'public')));

		//
		// UI endpoint: home page (not secured)
		//
		app.get('/', function(req,res) {
			// render index page
			res.render('index', {title: '/CloudDataServices Labs'});
		});

		//
		// UI endpoint: configure service (not secured)
		//
		app.get('/configure', function(req,res) {
			// render configure page
			res.render('configure', {});
		});

		//
		// UI endpoint: display package summary (not secured)
		//
		app.get('/stats', function(req,res) {
			// render stats page
			collector.getPackages(function(err, packages) {
				if(err) {
					console.log('/stats: error retrieving package list: ' + err);
					res.render('stats');
				}
				res.render('stats', {packages:JSON.stringify(packages)});	
			});
			
		});

		//
		// UI endpoint: display download summary (not secured)
		//
		app.get('/stats/:package', function(req,res) {
			/*
			  Expected payload:
			  -------------------------------------	
				req.params.package: 
			  -------------------------------------
			*/
			// render stats detail page
			res.render('stats_details', {package: req.params.package});
		});

		// 
		// helper: fetch download statistics for a package
		// 
		var getPackageDataByMonth = function(packagename, callback) {

			var options = {
				startkey: [packagename],
				endkey: [packagename,{}],
				group_level: 2
			};

			dataRepository.view('stats', 
							 	'stats',
							  	options,
							  	function(err, data) {
							  		if(err) {
										return callback(err);				  		
									}							  		
							  		return callback(null, data);
							  	});
		};

		// 
		// API endpoint: package downloads 
		// 
		app.get('/data/byMonth/:package', function(req,res) {
			/*
			  Expected payload:
			  -------------------------------------	
				req.params.package: 
			  -------------------------------------
			*/

			getPackageDataByMonth(req.params.package,
								  function(err, packagedownloads) {
							  		if(err) {
							  			console.log('Error fetching download stats for package ' + req.params.package + ' ' + err);
							  			res.sendStatus(500).send('Error fetching download stats for package ' + req.params.package + ' ' + err);
							  		}
							  		if(packagedownloads.rows.length > 0) {
							  			res.json(packagedownloads);	
							  		}							  
							  		else {
							  			res.sendStatus(404);
							  		}									  		
								  });	  

		});

		// 
		// API endpoint: package downloads visualization
		// 
		app.get('/charts/byMonth/:package', function (req, res) {
			/*
			  Expected payload:
			  -------------------------------------	
				req.params.package: 
			  -------------------------------------
			*/

			getPackageDataByMonth(req.params.package,
								  function(err, packagedownloads) {
							  		if(err) {
							  			console.log('Error fetching download stats for package ' + req.params.package + ' ' + err);
							  			res.sendStatus(500).send('Error fetching download stats for package ' + req.params.package + ' ' + err);
							  		}							  		
							  		
									var datavis = new SimpleDataVis(function() { return packagedownloads;});
									datavis.attr('type', 'grouped-bar-chart')
										    .on('data', function(data) {
										    	    var output = [];
										    		if(data.rows) {
										    			data.rows.forEach(function(row) {
										    				debug(JSON.stringify(row));	
										    				output.push({key: row.key[1], value: row.value});
										    			});
										    		}
										        	return output;})
										    .on('end', function (data, svgnode) {
										    		if(svgnode) {
														res.set('Content-Type', 'image/svg+xml');
										        		res.send(svgnode.node().outerHTML);
										    		}
										    		else {
										    			res.sendStatus(404);
										    		}
										    	})
										    .render();	
								  });	
		});

		// 
		// API endpoint: service information
		// 
		app.get('/status', function (req, res) {
			/*
			  Expected payload:
			  -------------------------------------	
				none
			  -------------------------------------
			*/

			var info = {
				source: 'https://github.com/ibm-cds-labs/npmjs-download-stats',
				last_index_scan: indexer.getLastScanTime(),
				last_data_collection: collector.getLastCollectionTime()
			};

			collector.getPackages(function (err, data) {
					if(!err) {
						info.packages = data;
					}
					res.json(info);			
			});
		});

		//
		// start server on the specified port and binding host
		//
		app.listen(appEnv.port, '0.0.0.0', function() {
			console.log('Server starting on ' + appEnv.url);
		});

		//
		// periodically replace stale statistics
		//
		setInterval(function() {
			console.log('Refreshing statistics ...');
			refresh();
		}, 604800000); // every 7 days
	});

	// send sample application deployment tracking request to https://github.com/IBM-Bluemix/cf-deployment-tracker-service
	//require('cf-deployment-tracker-client').track();
