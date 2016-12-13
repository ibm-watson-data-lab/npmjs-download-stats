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

const debug = require('debug')('npmjs:index');

function NPMJSIndexer(repository) {

	this.dataRepository = repository;
	// stats doc index
	this.statsIndex = {
						/*
							<PACKAGE_ID>: {
											<YEAR>:
											        {
														<MONTH>: status    // 0 = missing data, 1 = stale, 2 = okay
											        }
										  }
						 */	
					  };

}

/**
 * Builds the download statistics index
 *
 */
NPMJSIndexer.prototype.buildIndex = function(callback) {

	if(! this.dataRepository) {
		return callback('No data repository is defined.');
	}

	var currentdate = new Date().toISOString().substring(0,7); // e.g. 2016-12

	// fetch list of all stats documents
	this.dataRepository.list(function(err, data) {
								if(err) {
							  		return callback(err);
							  	}

							  	if(data && data.rows) {
							  		const idpattern = /^(.+)_([0-9]{4})\-([0-9]{2})$/;
							  		var packageyearmonth = null;
								  	_.forEach(data.rows, function(row) {
								  		if(! row.id.startsWith('_')) {
								  			// process all docs except metadata docs (e.. design, replication, ...)
								  			// document id format: <PACKAGE_ID>_<YYYY>-<MM>
								  			packageyearmonth = idpattern.exec(row.id);
								  			debug(JSON.stringify(packageyearmonth));
								  			if(packageyearmonth) {
									  			if(! this.statsIndex.hasOwnProperty(packageyearmonth[1])) {
									  				this.statsIndex[packageyearmonth[1]] = {};
									  			}
												if(! this.statsIndex[packageyearmonth[1]].hasOwnProperty(packageyearmonth[2])) {
									  				this.statsIndex[packageyearmonth[1]][packageyearmonth[2]] = {};
									  			}
												if(! this.statsIndex[packageyearmonth[1]][packageyearmonth[2]].hasOwnProperty(packageyearmonth[3])) {
													if(currentdate === (packageyearmonth[2] + '-' + [packageyearmonth[3]])) {
									  					this.statsIndex[packageyearmonth[1]][packageyearmonth[2]][packageyearmonth[3]] = 1; // data is potentially stale
									  				}
									  				else {
										  				this.statsIndex[packageyearmonth[1]][packageyearmonth[2]][packageyearmonth[3]] = 2;	// data is okay
									  				}
									  			}
								  			}
								  		}
										
								  	}.bind(this));
								}
								console.log('Index build finished.');							  	
								debug('Index: ' + JSON.stringify(this.statsIndex));

							  	callback(null);
							  }.bind(this));
};


/**
 * Inspects the index for stale or missing information
 *
 */
NPMJSIndexer.prototype.inspectIndex = function(packages, callback) {

	if(! packages) {
		packages = Object.keys(this.statsIndex);
	}
	else {
		if(! Array.isArray(packages)) {
			packages = [packages];
		}		
	}
	var todolist = {};
	var currentdate = new Date();
	const currentyear = currentdate.toISOString().substring(0,4);  // YYYY
	const currentmonth = currentdate.toISOString().substring(5,7); // MM
	
	var years = ['2015','2016'];
	const months = ['01','02','03','04','05','06','07','08','09','10','11','12'];

	debug('Inspecting index for stale or missing data ...');
	debug('Date range: ' + currentyear + ' ' + currentmonth);

	// helper; adds packageid to the TODO list for 
	// the specified year (if month is null) or month
	// TODO dates in the future are ignored
	const updateTODO = function(packageid, missingyear, month) {
		if(! todolist.hasOwnProperty(missingyear)) {
			todolist[missingyear] = {};
			if(month === null) {
				todolist[missingyear] = {
										'01': [ packageid ],
										'02': [ packageid ],
										'03': [ packageid ],
										'04': [ packageid ],
										'05': [ packageid ],
										'06': [ packageid ],
										'07': [ packageid ],
										'08': [ packageid ],
										'09': [ packageid ],
										'10': [ packageid ],
										'11': [ packageid ],
										'12': [ packageid ]
									   };
			}
			else {
				todolist[missingyear][month] = [ packageid ];
			}
		}
		else {
			if(month === null) {
				_.forEach(months,
						  function(month) {
							if(! todolist[missingyear].hasOwnProperty(month)) {
								todolist[missingyear][month] = [ packageid ];
							}
							else {
								todolist[missingyear][month].push(packageid);	
							}
				}.bind(this));
			}
			else {
				if(! todolist[missingyear].hasOwnProperty(month)) {
					todolist[missingyear][month] = [ packageid ];
				}
				else {
					todolist[missingyear][month].push(packageid);	
				}
			}
		}
	};

	// generate TODO list
	_.forEach(packages, 
			  function(packageid) {
			  	debug('Inspecting index for package ' + packageid + ' ...');
			  	if(this.statsIndex.hasOwnProperty(packageid)) {
			  		// some (or all) download statistics have been collected previously for this package
			  		// identify any potential gaps in coverage
			  		_.forEach(years, 
			  			      function(year) {
			  			      	debug('Inspecting index for ' + year + ' ...');
			  			      	if(! this.statsIndex[packageid].hasOwnProperty(year)) {
			  			      		debug('Index for ' + year + ' is missing for package ' + packageid);
			  			      		updateTODO(packageid, year, null);
								}
								else {
									// check whether the packages' download stats are present for all months
									_.forEach(months,
											  function(month) {
											  	debug('Inspecting index for ' + month + ' ' + year + ' ...');
												if(! this.statsIndex[packageid][year].hasOwnProperty(month)) {
													updateTODO(packageid, year, month);													
												}
									}.bind(this));
								}
			  				  }.bind(this));
			  	}
			  	else {
			  		// no download statistics have been collected previously for this package; add to TODO list
			  		_.forEach(years, 
			  			      function(year) {
			  					updateTODO(packageid, year, null);
			  				  });
			  	}
	}.bind(this));

	debug('The following statistics are missing: ' + JSON.stringify(todolist));
	
	if(Object.keys(todolist).length > 0) {
		return callback(null, todolist);
	} 
	else {
		return callback(null, null);
	}	
};

module.exports = NPMJSIndexer;
