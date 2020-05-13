# jambonz-rtpengine-utils

Usage
```
const {getRtpEngine} = require('jambonz-rtpengine-utils')(['10.10.0.1:2222', '10.10.02:2222']);
const obj = getRtpEngine(logger):
/*
  obj is {
    offer:    /* bound function that calls 'offer' on least loaded rtpengine */
    answer:   /* ditto answer.. */
    del:      /* ditto delete.. */
    client:   /* rtpengine client that will be used for sending commands */
  }
*/
```