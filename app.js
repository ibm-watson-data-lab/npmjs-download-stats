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
const got = require('got');
const bodyParser = require('body-parser');
const passport = require('passport');
const path = require('path');
const SimpleDataVis = require('simple-data-vis');

// to enable debugging, set environment variable DEBUG to nps or *
const debug = require('debug')('npmjs');

const init = require('./lib/initialize.js');
const security = require('./lib/security.js');

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

		debug('Retrieving configuration ...');
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
						debug('Index was built. Identifying stale or missing statistics ...');
						indexer.inspectIndex(config, 
											 function(err, todolist) {
											 	if(err) {
													console.error('Index inspection error: ' + err);						 		
											 	}
											 	else {
													debug('Collecting missing statistics ... ');
													collector.collect(todolist,
																	  function(err, data) {
																	  		if(err) {
																	  			console.error('Statistics collector error: ' + err);
																	  		}
																	  		else {
																	  			debug('Statistics collection results: ' + JSON.stringify(data));
																	  		}
																	  });
											 	}
											 });
					}
				});
			}
		});		

		var app = express();
		app.use(bodyParser.urlencoded({extended: true}));
		app.use(bodyParser.json()); // for parsing application/json

  		// use https://www.npmjs.com/package/express-handlebars as view engine
		app.engine('handlebars', exphbs({layoutsDir: 'public/layouts',
										 defaultLayout: 'main', 
			                             helpers: { 
			                             	getSlashCommand: function() { 
			                             		return process.env.SLACK_SLASH_COMMAND || 'nps';}
			                             }}));
		app.set('view engine', 'handlebars');
		app.set('views', 'public');
		app.use(express.static(path.join(__dirname, 'public')));

		console.log('Application security is set to: "' + security.strategyName + '"');
  		passport.use(security.strategy);

		//
		// UI endpoint: home page (not secured)
		//
		app.get('/', function(req,res) {
			// render index page
			res.render('index', {});
		});

		//
		// UI endpoint: configure service (optionally secured)
		//
		app.get('/configure', 
			    passport.authenticate(security.strategyName, {session:false}),
				function(req,res) {					
					// render configure page
					config.getPackageWatchlist(function(err, packages) {
						if(err) {
							console.error('Error fetching package watch list: ' + err);
							packages = [];
						}
						res.render('configure', {packages: packages});		
					});					
		});

		//
		// API endpoint: configure service (optionally secured)
		//
		app.post('/configure', 
			    passport.authenticate(security.strategyName, {session:false}),
				function(req,res) {

					debug('Configuration update request: ' + require('util').inspect(req.body));

					if(req.body.hasOwnProperty('packages')) {
						config.setPackageWatchlist(req.body.packages);	
					}

					config.saveConfig(function(err) {
						if(err) {
							console.error('Error updating package watch list: ' + err);
							res.sendStatus(500);	
						}
						res.sendStatus(200);
					});
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
				res.render('stats', {packages:packages});	
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
		// API endpoint: determine if a package is registered in npmjs (not secured)
		//
		app.head('/verify/npmjs/:package', function(req,res) {
			/*
			  Expected payload:
			  -------------------------------------	
				req.params.package: 
			  -------------------------------------
			*/
			got.head('https://npmjs.com/package/' + req.params.package)
			.then(function() {res.sendStatus(200);})
			.catch(function(error) {res.sendStatus(error.statusCode);});
		});

		//
		// start server on the specified port and binding host
		//
		app.listen(appEnv.port, '0.0.0.0', function() {
			console.log('Server starting on ' + appEnv.url);
		});

		//
		// periodically remove expired tokens from the repository database
		//
		setInterval(function() {
			// TODO
		}, 900000); // every 15 minutes
	});

	// send sample application deployment tracking request to https://github.com/IBM-Bluemix/cf-deployment-tracker-service
	//require('cf-deployment-tracker-client').track();
