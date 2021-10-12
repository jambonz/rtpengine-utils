const assert = require('assert');
const Client = require('rtpengine-client').Client ;
const debug = require('debug')('jambonz:rtpengines-utils');
const Emitter = require('events');
const dgram = require('dgram');
const noopLogger = {info: () => {}, error: () => {}};
let engines = [];
let timer;
let idx = 0;
const PING_INTERVAL = process.env.RTPENGINE_PING_INTERVAL ? parseInt(process.env.RTPENGINE_PING_INTERVAL) : 20000;
const myPingInterval = Math.min(60000, Math.max(PING_INTERVAL, 10000));
const dtmfCallbacks = new Map();
let socket;

const makeKey = (callid, source_tag) => `${callid}-tag-${source_tag}`;

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

const _subscribeDTMF = (engine, listenPort, logger, callid, source_tag, callback) => {
  assert.ok(typeof callback === 'function',
    'subscribeDTMF signature must be (logger, callid, source_tag, callback)');
  if (!socket) {
    socket = dgram.createSocket('udp4');
    socket
      .on('error', (err) => {
        logger.info({err}, 'rtpengine-utils: _subscribeDTMF error');
        socket.close();
      })
      .on('message', (message, rinfo) => {
        try {
          const payload = JSON.parse(message.toString('utf-8'));
          debug({payload, rinfo}, 'rtpengine-utils - received DTMF event from rtpengine');
          const key = makeKey(payload.callid, payload.source_tag);
          const obj = dtmfCallbacks.get(key);
          if (obj) {
            if (obj.lastMessage && 0 === Buffer.compare(message, obj.lastMessage)) {
              debug({payload, rinfo}, 'discarding duplicate dtmf report');
            }
            else {
              debug(payload, `invoking DTMF callback for ${key}`);
              obj.lastMessage = message;
              obj.callback(payload);
            }
          }
        } catch (err) {
          logger.info({err, message}, `Error invoking callback for callid ${key}`);
        }
      });
    socket.bind(listenPort);
  }
  const key = makeKey(callid, source_tag);
  dtmfCallbacks.set(key, {callback});

  const msg = {
    type: 'subscribeDTMF',
    callid,
    source_tag,
    listenPort
  };
  debug({key}, `_subscribeDTMF: sending to ${engine.host}:${engine.port + 1}, now ${dtmfCallbacks.size} entries`);
  socket.send(JSON.stringify(msg), engine.port + 1, engine.host, (err) => {
    if (err) logger.info({err, callid}, 'Error subscribing for DTMF');
  });
};
const _unsubscribeDTMF = (engine, logger, callid, source_tag) => {
  assert(socket);
  const key = `${callid}-tag-${source_tag}`;
  const msg = {
    type: 'unsubscribeDTMF',
    callid,
    source_tag
  };

  dtmfCallbacks.delete(key);
  debug(`_unsubscribeDTMF: there are now ${dtmfCallbacks.size} entries`);
  socket.send(JSON.stringify(msg), engine.port + 1, engine.host, (err) => {
    if (err) logger.info({err, callid}, 'Error unsubscribing for DTMF');
  });
};

const _setEngines = (logger, client, arr, opts) => {
  opts = opts || {};
  const {dtmfListenPort} = opts;

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
      if (dtmfListenPort) {
        engine.subscribeDTMF = _subscribeDTMF.bind(null, engine, dtmfListenPort);
        engine.unsubscribeDTMF = _unsubscribeDTMF.bind(null, engine);
      }
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
        del: engine.delete,
        list: engine.list,
        ping: engine.ping,
        query: engine.query,
        startRecording: engine.startRecording,
        stopRecording: engine.stopRecording,
        blockDTMF: engine.blockDTMF,
        unblockDTMF: engine.unblockDTMF,
        playDTMF: engine.playDTMF,
        blockMedia: engine.blockMedia,
        unblockMedia: engine.unblockMedia,
        playMedia: engine.playMedia,
        stopMedia: engine.stopMedia,
        statistics: engine.statistics,
        subscribeDTMF: engine.subscribeDTMF,
        unsubscribeDTMF: engine.unsubscribeDTMF,
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
