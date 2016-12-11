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

}

NPMJSCollector.prototype.getPackages = function(callback) {

	if(! this.dataRepository) {
		return callback("No data repository is defined.");
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


NPMJSCollector.prototype.collectMonth = function(packages, year, month, callback) {

	if(! this.dataRepository) {
		return callback("No data repository is defined.");
	}

	if(! packages) {
		return callback(); // nothing to do
	}

	if(! Array.isArray(packages)) {
		packages = [packages];
	}

	var dateRangeStart = new Date(year, month - 1,1).toISOString().substring(0,10);
	var dateRangeEnd =	new Date(year, month, 0).toISOString().substring(0,10);

	debug("Collecting download statistics for " + packages.toString() + " for date range " + dateRangeStart + " and " + dateRangeEnd);

	// submit npmjs request
	// sample: https://api.npmjs.org/downloads/range/2016-01-01:2016-02-01/cloudant
	this.npmjsClient.getAll({ dateRange: dateRangeStart + ":" + dateRangeEnd , packages: packages},
						    function(err, data) {
						    	if(err) {
						    		return callback(err);
						    	}

						    	if(data.hasOwnProperty("error")) {
						    		if(data.error === 'no stats for this package for this range (0008)') {
						    			return callback(); // nothing to do; don't return an error
						    		}
						    		else {
						    			return callback(data.error);
						    		}
						    	}
						    		
						    	debug("Err: " + JSON.stringify(err));
						    	debug("Data: " + JSON.stringify(data));

						    	// iterate through packages and create a stats doc for each
						    	var statsDocs = [];
						    	var root = null;
						    	var total = 0;
						    	_.forEach(packages, 
						    		      function(packageName) {
						    		      	debug("Checking for download information for package " + packageName);
						    		      	root = null;
						    		      	if(data.hasOwnProperty(packageName)) {
						    		      		root = data[packageName];	
						    		      	}
						    		      	else {
						    		      		if(data.hasOwnProperty("downloads")) {
						    		      			root = data;
						    		      		}
						    		      	}	
						    		      	if(root !== null) {
							    		      	debug(JSON.stringify(root));
							    		      	total = 0;
							    		      	_.forEach(root.downloads, function(download) {
							    		      		total = total + download.downloads;
							    		      	});

												statsDocs.push({
							    								_id: root["package"] + "_" + root.start.substring(0, 7),
							    								type: "stats",
							    								package: root["package"],
							    								language: "javascript",
							    								month: root.start.substring(0, 7),
							    								total: total,
							    								range: {
							    									start: root.start,
							    									end: root.end
							    								},
							    								data: root.downloads
							    						  		});						    		      		
						    		      	}
						    	});

						    	if(statsDocs.length > 0) {
						    		// store stats documents in Cloudant
						    		this.dataRepository.bulk({docs:statsDocs},
						    								 function(err, data) {
						    								 	debug(data);
						    								 	return callback(err);
						    								 });
						    	}
						    	else {
						    		return callback();						    		
						    	}
						    }.bind(this));
};

module.exports = NPMJSCollector;