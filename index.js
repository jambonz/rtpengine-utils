const assert = require('assert');
const Client = require('rtpengine-client').Client ;
const debug = require('debug')('jambonz:rtpengines-utils');
const Emitter = require('events');
const noopLogger = {info: () => {}, error: () => {}};
let engines = [];
let timer;
let idx = 0;
const PING_INTERVAL = process.env.RTPENGINE_PING_INTERVAL ? parseInt(process.env.RTPENGINE_PING_INTERVAL) : 20000;
const myPingInterval = Math.min(60000, Math.max(PING_INTERVAL, 10000));

const _selectClient = (engines) => {
  const active = engines.filter((c) => c.active);
  if (active.length) return active[idx++ % active.length];
};

const _testEngines = (logger, engines, opts) => {
  debug('starting rtpengine pings');
  return setInterval(async() => {
    for (const engine of engines) {
      try {
        const res = await engine.statistics();
        if ('ok' === res.result) {
          engine.calls = res.statistics.currentstatistics.sessionstotal;
          engine.active = true;
          if (opts.emitter && opts.emitter instanceof Emitter) {
            opts.emitter.emit('resourceCount', {
              host: engine.host,
              hostType: 'sbc',
              resource: 'media.calls',
              count: engine.calls
            });
          }
          continue;
        }
        else if ('error' === res.result && res['error-reason'] && 'Unrecognized command' === res['error-reason']) {
          // older version of rtpengine
          engine.active = true;
        }
        else {
          logger.info({rtpengine: engine.host, response: res}, 'Failure response from rtpengine');
          engine.active = false;
        }
      } catch (err) {
        logger.info({rtpengine: engine.host, err}, 'Failure response from rtpengine');
      }
      engine.active = false;
    }
  }, opts.pingInterval || myPingInterval);
};

const _setEngines = (logger, client, arr, opts) => {
  if (timer) clearInterval(timer);

  engines = arr
    .map((hp) => {
      const arr = /^(.*):(.*)$/.exec(hp.trim());
      if (!arr) throw new Error('rtpengine-utils: must provide an array of host:port rtpengines');
      const engine = {
        active: true,
        calls: 0,
        host: arr[1],
        port: parseInt(arr[2])
      };
      [
        'answer',
        'delete',
        'list',
        'offer',
        'ping',
        'query',
        'startRecording',
        'stopRecording',
        'blockDTMF',
        'unblockDTMF',
        'playDTMF',
        'blockMedia',
        'unblockMedia',
        'playMedia',
        'stopMedia',
        'statistics'
      ].forEach((method) => engine[method] = client[method].bind(client, engine.port, engine.host));
      return engine;
    });
  logger.info({engines}, 'jambonz-rtpengine-utils: rtpengine list');
  timer = _testEngines(logger, engines, opts);
};


/**
 * function that returns an object containing a function --
 * that returned function (getRtpEngine) can be called repeatedly
 * to get a set of bound functions (offer, answer, del) that
 * are associated with the rtpengine having fewest calls
 *
 * {Array} arr - an array of host:port of rtpengines and their ng control ports
 * {object} logger - pino logger
 * {object} [opts] - configuration options
 * {number} [opts.timeout] - length of time in secs to wait for rtpengine to respond to a command
 * {number} [opts.pingInterval] - length of time in secs to ping rtpengines with a 'list' command
 */
module.exports = function(arr, logger, opts) {
  assert.ok(Array.isArray(arr), 'jambonz-rtpengine-utils: missing array of host:port rtpengines');
  opts = opts || {};
  logger = logger || noopLogger;

  const client = new Client({timeout: opts.timeout || 2500});
  _setEngines(logger, client, arr, opts);

  const getRtpEngine = () => {
    debug(`selecting rtpengine from array of ${engines.length}`);
    const engine = _selectClient(engines);
    if (engine) {
      debug({engine}, 'selected engine');
      return {
        offer: engine.offer,
        answer: engine.answer,
        del: engine.delete
      };
    }
  };

  const setRtpEngines = (arr) => {
    _setEngines(logger, client, arr, opts);
  };

  return {
    client,
    setRtpEngines,
    getRtpEngine
  };
};
