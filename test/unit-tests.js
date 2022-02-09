const test = require('tape');
const noLogger = {
  debug: () =>{},
  info: () =>{},
  warn: () =>{},
  error: (...args) => console.error(...args)
};

const fn = require('..');

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
});

function waitFor(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms * 1000);
  });
}

test('UDP tests', async(t) => {
  t.pass('waiting for rtpengine to come online');
  await waitFor(3);
  try {
    const rtpengines = ['127.0.0.1:22222'];
    const {setRtpEngines, getRtpEngine} = fn(rtpengines, noLogger, {protocol: 'udp'});
    const {ping, statistics} = await getRtpEngine();
  
    t.ok(typeof ping == 'function', 'created udp socket');
    let res = await ping();
    t.ok('pong' === res.result, 'successfully pinged rtpengine over udp');

    res = await statistics();
    t.ok('ok' === res.result, 'successfully queried stats rtpengine over udp');

    t.end();
  } catch (err) {
    console.log(`error: ${err}`);
    t.error(err);
  }
});

test('TCP tests', async(t) => {
  try {
    const rtpengines = ['127.0.0.1:22222'];
    const {setRtpEngines, getRtpEngine} = fn(rtpengines, noLogger, {protocol: 'tcp'});
    await waitFor(1);
    const {ping, statistics} = await getRtpEngine();
  
    t.ok(typeof ping == 'function', 'created tcp socket');
    let res = await ping();
    t.ok('pong' === res.result, 'successfully pinged rtpengine over tcp');

    res = await statistics();
    t.ok('ok' === res.result, 'successfully queried stats rtpengine over tcp');

    t.end();
  } catch (err) {
    console.log(`error: ${err}`);
    t.error(err);
  }
});

test('WS tests', async(t) => {
  try {
    const rtpengines = ['127.0.0.1:8088'];
    const {setRtpEngines, getRtpEngine} = fn(rtpengines, noLogger, {protocol: 'ws'});
    await waitFor(1);
    const {ping, statistics} = await getRtpEngine();
  
    t.ok(typeof ping == 'function', 'created ws socket');
    let res = await ping();
    t.ok('pong' === res.result, 'successfully pinged rtpengine over ws');

    res = await statistics();
    t.ok('ok' === res.result, 'successfully queried stats rtpengine over ws');

    t.end();
  } catch (err) {
    console.log(`error: ${err}`);
    t.error(err);
  }
});

