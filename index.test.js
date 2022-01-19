const WebSocket = require("ws");
const rtpengineUtils = require("./index");

const makeServer = ({onMessage}) => {
    const wss = new WebSocket.Server({ host: "127.0.0.1", port: "1234"});

    wss.on('connection', (ws) => {
        ws.on('message', (message)=> onMessage(message, ws));
        ws.send('hello');
    });

    wss.cleanupServer = () => new Promise((resolve)=> {
        wss.close(()=>{
          resolve();
        });
    });
    return wss;
}

describe("test index.js", ()=>{

    describe("test WS connection to RTP engine", ()=>{
        let wsServer;
        beforeEach(()=>{
           
        });
        afterEach(async ()=>{
            await wsServer.cleanupServer();
        });
        it("should reconnect multiple time if ws connection closes", async ()=>{
            const onMessage = jest.fn();
            onMessage.mockImplementationOnce((message, ws) => { 
                 ws.send(`echo ${message}`); 
                 ws.terminate();
            });
            onMessage.mockImplementationOnce((message, ws) => { 
                 ws.send(`echo ${message}`);
            });
            onMessage.mockImplementationOnce((message, ws) => { 
                 ws.send(`echo ${message}`); 
                 ws.terminate();
            });
            onMessage.mockImplementationOnce((message, ws) => { 
                 ws.send(`echo ${message}`);
            });
            wsServer = makeServer({onMessage });

            const {getRtpEngine} = rtpengineUtils(["127.0.0.1:1234"], null, {protocol: "ws"});

            const engine = getRtpEngine();
            // wait until we are connected
            await new Promise(resolve => setTimeout(resolve, 1000));

            let error;
            try{
                await engine.ping();
            }catch(err){
                error = err;
            }

            expect(error).toBeDefined();
            try{
                await engine.ping();
            }catch(err){
                error = err;
            }

            expect(error).toBeDefined();

             try{
                await engine.ping();
            }catch(err){
                error = err;
            }

            expect(error).toBeDefined();
            try{
                await engine.ping();
            }catch(err){
                error = err;
            }

            expect(error).toBeDefined();

            engine.dispose();
        }, 10000);
    });
});