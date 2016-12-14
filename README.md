# npmjs-download-stats

[![Build Status](https://travis-ci.org/ibm-cds-labs/npmjs-download-stats.svg?branch=master)](https://travis-ci.org/ibm-cds-labs/npmjs-download-stats)

#### Deploy on Bluemix

Download and deploy

```
 $ git clone https://github.com/ibm-cds-labs/npmjs-download-stats
 $ cd npmjs-download-stats
 $ cf create-service cloudantNoSQLDB Lite npmjs-cloudant
 $ cf push --no-start
```

Restrict access to the configuration page

```
  $ cf set-env npmjs-download-stats ADMIN_USER <ADMIN_USER_VALUE>
  $ cf set-env npmjs-download-stats ADMIN_PASSWORD <ADMIN_PASSWORD_VALUE>
```

Start application

```
 $ cf start npmjs-download-stats
```


#### Run locally

Download and install the code and its dependencies

```
 $ git clone https://github.com/ibm-cds-labs/npmjs-download-stats
 $ cd npmjs-download-stats
 $ npm install
 $ cf create-service cloudantNoSQLDB Lite npmjs-cloudant
 $ cf create-service-key npmjs-cloudant Credentials-1
 $ cf service-key npmjs-cloudant Credentials-1
```

> If you use a service instance name other than `npmjs-cloudant` set environment variable `COUCH_INSTANCE_NAME`.

* Copy file `vcap_services_template.json` to `vcap_services.json`.
* In `vcap_services.json` replace the `TODO` placeholders with your Cloudant instance information.

``` 
 $ 
 $ cf push
```