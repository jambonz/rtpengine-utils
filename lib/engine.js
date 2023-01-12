const Emitter = require('events');
const {Client, TcpClient, WsClient} = require('rtpengine-client') ;
const dgram = require('dgram');
const assert = require('assert');
const debug = require('debug')('jambonz:rtpengines-utils');
const CONSTS = require('./constants');
let udpClient, socket;

const getBoundUdpSocket = async(port) => {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    socket.on('error', (err) => reject(err));
    socket.on('listening', () => {
      socket.removeAllListeners();
      resolve(socket);
    });
    socket.bind(port);
  });
};

const getDtmfListeningSocket = async(logger, desiredPort, retries) => {
  let port = desiredPort;
  const maxPort = desiredPort + retries;
  while (port < maxPort) {
    try {
      const socket = await getBoundUdpSocket(port);
      return socket;
    }
    catch (err) {
      logger.info({err, port}, 'Error binding to port');
      port++;
    }
  }
};

class Engine extends Emitter {
  constructor(logger, {
    host,
    port,
    protocol = 'udp',
    timeout,
    dtmfListenPort
  }) {
    super();
    this.logger = logger;
    this.host = host;
    this.port = port;
    this.protocol = protocol;
    this.timeout = timeout;
    this.dtmfListenPort = dtmfListenPort;
    this.active = this.isConnectionLess;

    if (this.isConnectionLess) {
      let localPort = process.env.JAMBONES_RTPENGINE_UDP_PORT ?
        parseInt(process.env.JAMBONES_RTPENGINE_UDP_PORT) :
        0;
      if (localPort && process.env.INSTANCE_ID) {
        localPort += parseInt(process.env.INSTANCE_ID);
      }
      this.client = udpClient = new Client({
        localPort,
        timeout: this.timeout
      });
    }
  }

  get isConnectionLess() {
    return 'udp' === this.protocol;
  }

  get isActive() {
    return this.active && (this.isConnectionLess || this.client?.connected);
  }

  async connect(reconnect = false) {
    switch (this.protocol) {
      case 'udp':
        this._addCommandSet();
        this.client.on('error', this._onSocketError.bind(this));
        return this;
      case 'tcp':
        this.client = new TcpClient({hostport: `${this.host}:${this.port}`, timeout: this.timeout});
        break;
      case 'ws':
        this.client = new WsClient({url: `ws://${this.host}:${this.port}`, timeout: this.timeout});
        break;
      default:
        throw new Error(`invalid protocol: ${this.protocol}`);
    }
    this._addCommandSet();
    this.client
      .on('listening', () => this.active = true)
      .on('error', this._onSocketError.bind(this));
    return this;
  }

  destroy() {
    if (this.client && !this.isConnectionLess) {
      this.client.close();
    }
    this.client = null;
  }

  async test(emitter) {
    if ('test' === process.env.NODE_ENV) return;
    const gatherStats = emitter instanceof Emitter;
    const func = gatherStats ? this.statistics : this.ping;
    const res = await func();
    if ('ok' === res.result || 'pong' === res.result) {
      this.active = true;
      if (gatherStats) {
        this.calls = res.statistics.currentstatistics.sessionstotal;
        emitter.emit('resourceCount', {
          host: this.host,
          hostType: 'sbc',
          resource: 'media.calls',
          count: this.calls
        });
      }
    }
    else if ('error' === res.result && res['error-reason'] && 'Unrecognized command' === res['error-reason']) {
      // older version of rtpengine
      this.active = true;
    }
    else {
      this.logger.info({rtpengine: this.host, response: res}, 'Failure response from rtpengine');
      this.active = false;
    }
  }

  _addCommandSet() {
    if (this.isConnectionLess) {
      CONSTS.ENGINE_COMMANDS.forEach((method) => {
        this[method] = udpClient[method].bind(udpClient, this.port, this.host);
      });
    }
    else {
      assert(this.client);
      CONSTS.ENGINE_COMMANDS.forEach((method) => this[method] = this.client[method].bind(this.client));
    }
  }

  getFunctionalInterface() {
    const obj = {};
    CONSTS.ENGINE_COMMANDS
      .forEach((m) => obj[m] = this[m]);

    if (this.dtmfListenPort) {
      obj.subscribeDTMF = _subscribeDTMF.bind(null, this, this.dtmfListenPort);
      obj.unsubscribeDTMF = _unsubscribeDTMF.bind(null, this);
    }
    obj.destroy = this.destroy;
    obj.del = this.delete;
    return obj;
  }

  _onSocketError(err) {
    this.logger.info({err},
      `rtpengine-utils: socket error on ${this.protocol} connection to ${this.host}:${this.port}`);
  }
}

module.exports = Engine;

/* */
/* dtmf helpers -- listen for dtmf events relayed over udp by sbc-rtpengine-sidecar */
/* */
const dtmfCallbacks = new Map();

const makeKey = (callid, source_tag) => `${callid}-tag-${source_tag}`;

const _subscribeDTMF = (engine, listenPort, logger, callid, source_tag, callback) => {
  assert.ok(typeof callback === 'function',
    'subscribeDTMF signature must be (logger, callid, source_tag, callback)');

  const doRegisterForDtmf = async(socket) => {
    const key = makeKey(callid, source_tag);
    dtmfCallbacks.set(key, {callback});

    const msg = {
      type: 'subscribeDTMF',
      callid,
      source_tag,
      listenPort: socket.address().port
    };
    logger.debug({
      key,
      host: engine.host,
      port: engine.port + 1
    }, `_subscribeDTMF: sending to sbc-rtpengine-sidecar; there are now ${dtmfCallbacks.size} entries`);
    socket.send(JSON.stringify(msg), engine.port + 1, engine.host, (err) => {
      if (err) logger.info({err, callid}, 'Error subscribing for DTMF');
    });
  };

  if (!socket) {
    getDtmfListeningSocket(logger, listenPort, 9)
      .then((s) => {
        socket = s;
        logger.info(`DTMF listening socket bound to ${socket.address().port}`);
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
                /* DH: this code was intended to prevent duplicate events from being processed,
                but we found that rtpengine reports the same timestamp for separate
                dtmf events entered very quickly

                if (obj.lastMessage && 0 === Buffer.compare(message, obj.lastMessage)) {
                  logger.debug({payload, rinfo}, 'discarding duplicate dtmf report');
                }
                */
                debug(payload, `invoking DTMF callback for ${key}`);
                obj.lastMessage = message;
                obj.callback(payload);
              }
            } catch (err) {
              logger.info({err, message}, 'Error invoking callback');
            }
          });
        doRegisterForDtmf(socket);
        return s;
      })
      .catch((err) => {
        logger.info({err}, 'Error creating DTMF listening socket');
      });
  }
  else {
    doRegisterForDtmf(socket);
  }
};

const _unsubscribeDTMF = (engine, logger, callid, source_tag) => {
  if (!socket) {
    logger.error('rtpengine-utils: _unsubscribeDTMF called but no socket');
    return;
  }
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
