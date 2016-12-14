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

const debug = require('debug')('npmjs:config');

const configdocid = 'config';

/**
 *
 */
function Config(repository) {

	this.metaRepository = repository;
	this.config = null;
}

/**
 * Retrieves the configuration document from the repository database 
 *
 */
Config.prototype.getConfig = function(callback) {

	if(! this.metaRepository) {
		return callback('No data repository is defined.');
	}

	debug('Getting config doc with id ' + configdocid + ' from repository ...');
	// fetch configuration document 
	this.metaRepository.get(configdocid,
							function(err, configdoc) {
								if(err) {								
							  		return callback(err);
							  	}
							  	debug('Got config doc with id ' + configdocid + ': ' + JSON.stringify(configdoc));
							  	this.config = configdoc;
							  	return callback(null, this.config);
							}.bind(this));
};

/**
 * 
 *
 */
Config.prototype.saveConfig = function(callback) {

	if(! this.metaRepository) {
		return callback('No data repository is defined.');
	}

	if(! this.config) {
		return; // nothing to do
	}

	debug('Saving configuration document in repository: ' + JSON.stringify(this.config));

	// fetch configuration document 
	this.metaRepository.get(configdocid,
							function(err, configdoc) {
								if(err) {
							  		return callback(err);
							  	}
							  	this.config._rev = configdoc._rev;
							  	this.metaRepository.insert(this.config,
							  							   function(err) {
							  							   		return callback(err);
							  							   });
							}.bind(this));
};

/**
 * Updates the package watchlist
 * @param packages for which deployments will be tracked
 */
Config.prototype.setPackageWatchlist = function(packages) {

	// normalize parameter
	packages = packages || [];
	if(! Array.isArray(packages)) {
		packages = [packages];
	}

	this.config.packages = packages;
};


/**
 * Returns the list of packages that this service is watching
 * @return String[] identifying packagesin the watch list
 */
Config.prototype.getPackageWatchlist = function(callback) {
	if(! this.config) {
		this.getConfig(function(err) {
			if(err) {
				return callback(err);
			}
			else {
				return callback(null, this.config.packages);
			}
		}.bind(this));
	}
	else {
		return callback(null, this.config.packages);
	}
};


//--------------------------------------------------------------------
//							 class methods
//-------------------------------------------------------------------- 

/**
 * Returns a valid default configuration document for this service.
 * @return
 */
const getDefaultConfig = function() {

	return {
			_id: 'config',
			packages: [],
			start_year: new Date().toISOString().substring(0,4)
           };
};


//--------------------------------------------------------------------
//							 exports
//--------------------------------------------------------------------  
module.exports = { 
					Config,
					getDefaultConfig
				 };


