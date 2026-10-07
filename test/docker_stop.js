const test = require('tape').test ;
const exec = require('child_process').exec ;

/* open rtpengine sockets keep the process alive, so we exit explicitly - with a status that reflects the tests */
let failed = false;
require('tape').onFailure(() => failed = true);

test('stopping docker network..', (t) => {
  t.timeoutAfter(10000);
  exec(`docker compose -f ${__dirname}/docker-compose-testbed.yaml down`, (err, stdout, stderr) => {
    //console.log(`stderr: ${stderr}`);
    process.exit(failed ? 1 : 0);
  });
  t.end() ;
});
