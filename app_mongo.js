/*
This is a program for an elite, narrow group of several Epic Box operators in the world. 
If you are not one of them, reading this code is pointless.
*/

const fs = require("fs")

// Html server used for websockets server
const {createServer} = require("http")

// Used for execute rust module which fast check addreses and verify signatures 
const { execFile } = require('node:child_process')

// For generate uid message id for Slate sending to wallet.
const uid = require('uid2')

// Websocket for communicate with other epicboxes, and Websocket Server for receive all ws connections from wallets
const { WebSocket, WebSocketServer } = require('ws')

// Mogodb driver for externally store messageid and slates for ver 2.0.0. of epicbox, tp work with answer by wallet with slate id message
const { MongoClient } = require('mongodb');

// Connection URL for mongo, please change if your mongo server is on other location, you can add authorization and open firewall for it.
// each instance of epicbox which you run on your domain must use the same mongodb -- so change to correct ip and remeber open ports in firewall
// it's good idea to add one field (createdat:new Date()) in stored document and set index with timeout which which can delete documents which are old about 3-4 days
// because in special situation when wallet use 2.0.0 and later use older version stored messagid information from mognodb can't be removed by epicbox
const mongourl = "mongodb://localhost:27017"
const mongoclient = new MongoClient(mongourl)
const dbName = "epicbox"
const collectionname = "slates"

var challenge = "7WUDtkSaKyGRUnQ22rE3QUXChV8DmA6NnunDYP4vheTpc"


// change to your epicbox domaina
const epicbox_domain = "epicbox.fastepic.eu"
const epicbox_port =  443

// change to your port - standard is 3423 - remeber to open locale firewall - in linux sudo ufw 3424 allow
// you can run many instance of this epicbox - simpel copy folder with other name and change this port to next which you want
// remeber to correct set nginx to switch between different instances of epic box - read more in my git about it.
const localepicboxserviceport = 3424

// interval for check in intervals if new Slates are for connected wallets ( it is not the same what interval in wallets ! )
var interval = null

// time of interval ( ms ) in which epicbox can try repeat send the oldest slate for address.
//
const intervalperiod = 4000 // 4 seconds 


//Where is executable rust named epicboxlib compiled from epicboxlib subfolder
const pathtoepicboxlib = "./epicboxlib"

//current version of protocol of epicboxnodejs ( wallet can use lower )
//
const protver = "2.0.0"

var statistics = {
  
  from: new Date(),
  connectionsInHour: 0,
  slatesReceivedInHour: 0,
  slatesRelayedInHour:0,
  slatesSentInHour: 0,
  subscribeInHour: 0,
  activeconnections: 0,
  slatesAttempt:0
}

setInterval(()=>{

  
  statistics = {

    from: new Date(),
    connectionsInHour: 0,
    slatesReceivedInHour: 0,
    slatesRelayedInHour: 0,
    slatesSentInHour: 0,
    subscribeInHour: 0,
    activeconnections: 0,
    slatesAttempt:0   
  }

},60*60*1000);


/*
// html webpage displayed when you open domain in webbrowser. Information about other main epicbox servers.
// this webpage can be rather small in size
const html = `<!DOCTYPE html>\n\
<html>\n\
<head>\n\
<title>Epicbox</title>\n\
<style>a:link {\n\
  color: orange;\n\
} a:visited {\n\
  color: orange;\n\
}</style>\n\
</head>\n\
<body style='background-color: #242222; color: lightgray; margin-left: 20px;''>\n\
\n\
<h1>Epicbox servers.</h1>\n\
<p>Asia, Australia - epicbox.hyperbig.com</p>\n\
<p>North America, South America - epicbox.epic.tech</p>\n\
<p>US East Cost - epicbox.epicnet.us</p>\n\
<p>Africa, Europe - epicbox.fastepic.eu</p>\n\
<br>\n\
<p>More about Epic</p>\n\
<a href='https://epic.tech'>Epic Cash main webpage</a>\n\
<br>\n\
<br>\n\
    Example use in toml file.\n\
\n\
<pre>\n\
<code>\n\
\n\
[epicbox]\n\
epicbox_domain = 'epicbox.fastepic.eu'\n\
epicbox_port = 443\n\
epicbox_protocol_unsecure = false\n\
epicbox_address_index = 0\n\
epicbox_listener_interval = 10\n\
\n\
</code>\n\
</pre>\n\
\n\
</body>\n\
</html>`

*/

const requestListener = function (req, res) {
      res.writeHead(200)
      res.end(`<!DOCTYPE html>\n\
<html>\n\
<head>\n\
<title>Epicbox</title>\n\
<style>a:link {\n\
  color: orange;\n\
} a:visited {\n\
  color: orange;\n\
}</style>\n\
</head>\n\
<body style='background-color: #242222; color: lightgray; margin-left: 20px;''>\n\
\n\
<h1>Epicbox servers. Local server number 1</h1>\n\
<p>Asia, Australia - epicbox.hyperbig.com</p>\n\
<p>North America, South America - epicbox.epic.tech</p>\n\
<p>US East Cost - epicbox.epicnet.us</p>\n\
<p>Africa, Europe - epicbox.fastepic.eu</p>\n\
<br>\n\
<p>More about Epic</p>\n\
<a href='https://epic.tech'>Epic Cash main webpage</a>\n\
<br>\n\
<br>\n\
    Example use in toml file.\n\
\n\
<pre>\n\
<code>\n\
\n\
[epicbox]\n\
epicbox_domain = 'epicbox.fastepic.eu'\n\
epicbox_port = 443\n\
epicbox_protocol_unsecure = false\n\
epicbox_address_index = 0\n\
epicbox_listener_interval = 10\n\
\n\
</code>\n\
</pre>\n\
<br>\n\
<h1>\n\
Epicbox Statistics from ${statistics.from.toUTCString()}:\n\
</h1>\n\
<h3>\n\
connections: ${statistics.connectionsInHour}<br>\n\
active connections: ${statistics.activeconnections}<br>\n\
subscribes: ${statistics.connectionsInHour}<br>\n\
received slates: ${statistics.slatesReceivedInHour}<br>\n\
relayed slates: ${statistics.slatesRelayedInHour}<br>\n\
sending slate attempts: ${statistics.slatesAttempt}<br>\n\
</h3>\n\
</body>\n\
</html>`);
}





//
// HTTMl server creation with function for receives requests
// Used by WebSocketServer
//
const server =  createServer(requestListener);


// uncommented WebSocket creation with option for zip messages 
/*
const wss = new WebSocketServer({
  //port:  3425,
  server:server,
  perMessageDeflate: {
    zlibDeflateOptions: {
      // See zlib defaults.
      chunkSize: 1024,
      memLevel: 7,
      level: 3
    },
    zlibInflateOptions: {
      chunkSize: 10 * 1024
    },
    // Other options settable:
    clientNoContextTakeover: true, // Defaults to negotiated value.
    serverNoContextTakeover: true, // Defaults to negotiated value.
    serverMaxWindowBits: 10, // Defaults to negotiated value.
    // Below options specified as default values.
    concurrencyLimit: 10, // Limits zlib concurrency for perf.
    threshold: 1024 // Size (in bytes) below which messages
    // should not be compressed if context takeover is disabled.
  }
})*/


//WebSocket creation using HTTML server
const wss = new WebSocketServer({
  server:server,  
})

// function pon connectione - run when wallets connect by webscoket to epicbox 
wss.on('connection', function connection(ws, req) {
 
  statistics.connectionsInHour = statistics.connectionsInHour+1;

  ws.uid = uid(5);
  ws.epicboxver = null;
  ws.iphere =  null;
  // it is taken from nginx
  if(req.headers['x-forwarded-for']) ws.iphere = req.headers['x-forwarded-for'].split(',')[0].trim();
  const ip2 =  req.socket.remoteAddress;

  console.log(`[${new Date().toLocaleTimeString()}] [${ws.uid}] Connection from ip `, ws.iphere, " nginx/firewall ", ip2)

  ws.queueforsubscribe = null


  ws.on('close', (code, reason)=>{
     try{
      if(ws.queueforsubscribe!=null) {                                        
        console.log(`[${ws.uid}]`," Socket close for ", ws.queueforsubscribe)
         ws.queueforsubscribe = null;

      }
      console.log( `[${new Date().toLocaleTimeString()}] Close by code: `, code, " and reason ", reason.toString())

    } catch(err){
      console.error(err)
    }

  })

  ws.on('error', (errws) =>{
    console.error(errws)
    try{
    
      if(ws.queueforsubscribe!=null) {
        ws.queueforsubscribe = null;
 
      }  
    } catch(err){
      console.error(err)
    }
  });


  //
  //  Standard method send by wallets or by epicboxes to epicbox
  //  one Made is added for receive accept from wallets ( epicbox 2.0.0 suggestion )
  //
  ws.on('message', function message(data) {
    
   // console.log('received: %s', data)
    try{
      if(data.toString()=="ping") { ws.send("pong"); /*console.log("ping");*/ return; }
      if(data.toString()=="pong") {ws.send("ping"); /*console.log("pong");*/return;}    
   	  let json=JSON.parse(data)
      
       if(json.type=="Challenge") {
         console.log(json)
         console.log('[%s][%s] -> [%s] send return [%s]', new Date().toLocaleTimeString(), ws.iphere, "Challenge", challenge) 
        // remove for less move on internet, because Challenge is send automatic in interval but old wallets maybe need it
         ws.send(JSON.stringify({"type": "Challenge","str": challenge}))

       } else if(json.type=="Subscribe") {
           console.log(json)
           console.log('[%s][%s] -> [%s]', new Date().toLocaleTimeString(), ws.iphere, "Subscribe")
           subscribe(ws, json)	
       } else if(json.type=="Unsubscribe") {
           console.log(json)
           console.log('[%s][%s] -> [%s]', new Date().toLocaleTimeString(), ws.iphere, "Unsubscribe")
           unsubscribe(ws, json)  
       } else if(json.type=="PostSlate"){
          console.log('[%s][%s] -> [%s]', new Date().toLocaleTimeString(), ws.iphere, "PostSlate")
          postslate(ws, json)
       } else if(json.type=="Made"){
          console.log('[%s][%s] -> [%s]', new Date().toLocaleTimeString(), ws.iphere, "Made")
          made(ws, json)

       } else if(json.type=="GetVersion"){
          console.log('[%s][%s] -> [%s]', new Date().toLocaleTimeString(), ws.iphere, "GetVersion")
          let st = JSON.stringify({type:"GetVersion", str:protver})
          console.log(st) 
          ws.send(JSON.stringify({type:"GetVersion", str:protver}))

       } else if(json.type=="FastSend"){
          console.log('[%s][%s] -> [%s]', new Date().toLocaleTimeString(), ws.iphere, "GetVersion")
          fastsend(ws)

       } else console.log('received: %s', data); 

    } catch(err){
	  
    }
  });

  // here we send Challenge to wallet or other epicbox when connected

  let jsonhello = {"type":"Challenge","str":challenge}

  ws.send(JSON.stringify(jsonhello));

});


//
// Start fast send for 5 seconds
//

async function fastsend(ws){

  ws.fastsendcounter = 0;

  ws.fastsendInterval = setInterval(function(){

    ws.send(JSON.stringify({type:"FastSend"}));
    ws.fastsendcounter = ws.fastsendcounter + 1;
    if(ws.fastsendcounter>20) {

      ws.fastsendcounter = 0;
      clearInterval(ws.fastsendInterval);
    }

  }, 1000); 
    

}

//
// Subscribe function run when wallet send Subscribe message
//
async function subscribe(ws, json){
  console.log(`[${ws.uid}]`," subscribe ", json.address)
  
  try{
   
   // check if wallet wants use ver 2.0.0  
   if(json.hasOwnProperty("ver") && json.ver=="2.0.0") ws.epicboxver = "2.0.0"; 
    
    
   // start check using externally rust program for verify signature send from wallet 
   const child = execFile(pathtoepicboxlib, ["verifysignature", json.address , challenge, json.signature], (error, stdout, stderr) => {
     if (error) {
        throw error;
     }
     
     var isTrueSet = (stdout === 'true');
     
     // if sugnature is OK
     if(isTrueSet) {



// for backward for older wallets
/*
 try {
              
                const db = mongoclient.db(dbName);
                const collection = db.collection(collectionname);    

               // find message id send in Made message from vallet
               collection.find({ queue: json.address, made: false}).sort({ "createdat" : 1 }).limit(1).toArray().then((findResult)=>{


                   if(findResult.length>0) {

                      statistics.slatesAttempt = statistics.slatesAttempt + 1
                      console.log("try check and send from subscribe for  ", json.address)


                      let fromrabbit =  JSON.parse(findResult[0].payload)
                      let answer= {}
                      answer.type="Slate"
                      answer.from = findResult[0].replyto
                      answer.str = fromrabbit.str
                      answer.signature = fromrabbit.signature
                      answer.challenge = fromrabbit.challenge

                      let answerstr = null

                      if(ws.epicboxver == "2.0.0"){

                              let messageid = findResult[0].messageid                           
              
                              answer.epicboxmsgid = messageid
                              answer.ver = ws.epicboxver
                              answerstr = JSON.stringify(answer)                                                            
                              ws.send(answerstr)  
                              console.log("Sent to 2.0.0 ", json.address)

                      } else {

                            answerstr = JSON.stringify(answer)                      
                            ws.send(answerstr)
                            console.log("Looks sent to ", json.address)                            
                            collection.updateOne({messageid:findResult[0].messageid, made:false}, {$set:{made:true} }).then((updateResult)=>{


                            });

                      }
            

                    } else {
                      // console.log("msgrabbit ", msgrabbit)
                      //console.log("Error ", err)
                    } 


               }); 

            
        } catch(err){
          console.log(err)
        }

*/
// and for backward for older wallets      



           statistics.subscribeInHour = statistics.subscribeInHour+1
           if(ws.epicboxver) console.log(ws.epicboxver) 
           // here we store address of wallet which is queue in RabbitMq 
           ws.queueforsubscribe = json.address  

           ws.send(JSON.stringify({type:"Ok"}))

     } else {
      console.log("Signature error")
      ws.send(JSON.stringify({type:"Error", kind:"signature error", description:"Signature error"}))
     }
   });
  
 } catch(err){
        console.log(err)
	      ws.send(JSON.stringify({type:"Error", kind:"signature error", description:"Signature error"}))
  }
}


//
// run when wallet sent Unsuscribe Message
//
async function unsubscribe(ws, json){
  
  try{
    
    ws.queueforsubscribe = null;

    // fast send Ok message to wallet, because unsubscribe rather always without error  
    ws.send(JSON.stringify({type:"Ok"})); //return;

  } catch(e) {
    console.log(e)
  } 

}


//
// Run when wallet or other epicbox want send to epicbox Slate
// it can send to other epicbox when to address domain is differnet when our epicbox domain
//
async function postslate(ws, json){
  
  try {
     console.log("postslate from ", json.from, "to ", json.to)

   let from = json.from.split('@')
   from  = from[0]

   // use externally rust program to verify addresses - it is the same which is used to verify signatures
   const childadd = execFile(pathtoepicboxlib, ['verifyaddress',  json.from, json.to], (erroradr, stdoutadr, stderradr) => {
    if(erroradr){
    	throw erroradr
    }
   
    var isTrueSetadr = (stdoutadr === 'true');

    if(isTrueSetadr) { 

     // use rust program to verify signatures
     const child = execFile(pathtoepicboxlib, ["verifysignature", from , json.str, json.signature], (error, stdout, stderr) => {

       if (error) {
          throw error;
       }
       
       var isTrueSet = (stdout === 'true');
       
       
       if(isTrueSet) {
           
           statistics.slatesReceivedInHour = statistics.slatesReceivedInHour + 1
           preparePostSlate(ws, json, "")
       
       } else {
             
             // check again signatures --- why ? it is rather never used, but it is in orginal rust code.
             const child2 = execFile(pathtoepicboxlib, ["verifysignature", from , challenge, json.signature], (error, stdout, stderr) => {
              
                 var isTrueSet2 = (stdout === 'true');
                 if(isTrueSet2){

                   statistics.slatesReceivedInHour = statistics.slatesReceivedInHour + 1
                   preparePostSlate(ws, json, challenge);
                  
                  } else {
                   ws.send(JSON.stringify({type:"Error", kind:"postslate error", description:"PostSlate error"}))
                 }
             })
       }    

    })

    }  else {
                 ws.send(JSON.stringify({type:"Error", kind:"postslate error", description:"PostSlate Addresses error"}))
     
    }
   })


  } catch(err){
    console.error("postslate ", err)
    ws.send(JSON.stringify({type:"Error", kind:"postslate error", description:"PostSlate error"}))

  } 

}



//
// run only for wallets used ver 2.0.0
// for standard wallets never used
// it say by message Made that slate was received and correct made in wallet
// then epicbox can remove Slate from RabbotMq and message id from mongodb
//
function made(ws, json){

  console.log(json);
  
  try {

    if(json.hasOwnProperty("epicboxmsgid") && ws.epicboxver=="2.0.0" && json.hasOwnProperty("ver") && json.ver=="2.0.0"){


     // check signature by externally rust app 
     const child = execFile(pathtoepicboxlib, ["verifysignature", json.address , challenge, json.signature], (error, stdout, stderr) => {
         if (error) {
            throw error;
         }

         var isTrueSet = (stdout === 'true');
         
         if(isTrueSet) {

             console.log("Made signature OK")

             const db = mongoclient.db(dbName);
             const collection = db.collection(collectionname);
             console.log("Update for ", json.epicboxmsgid)
             collection.updateOne({messageid:json.epicboxmsgid, made:false}, {$set:{made:true}}).then((updateResult)=>{

                  console.log("make update result ", updateResult)

                  //ws.send(JSON.stringify({type:"Ok"})) 

             }).catch(console.error)

        }
      
      });
         

    } 

 } catch( err ){

    console.log(err)
 }

}



//
// run from postslate or forpostpostslat
// prepare received Slate for store in RabbitMq or send to other epicbox if domain of to address is different from this epicbox domain
//
function  preparePostSlate(ws, json, chall){

     let str = JSON.parse(json.str)
     let addressto= {}
     addressto.publicKey = str.destination.public_key
     addressto.domain = str.destination.domain
     addressto.port = str.destination.port
     if(addressto.port==null ) addressto.port = 443; else addressto.port = Number(addressto.port);

     if(addressto.domain==epicbox_domain && addressto.port===epicbox_port){
            
		        let signed_payload = {str: json.str, challenge: chall, signature: json.signature}
            signed_payload = JSON.stringify(signed_payload)
  
            let buf = Buffer.from(signed_payload)
            let epicboxreplyto = json.from


            const db = mongoclient.db(dbName);
            const collection = db.collection(collectionname);   


            // here insert slate to mongo - here is added messageId which is used in ver. 2.0.0

            collection.insertOne({ queue:addressto.publicKey, made:false, payload:buf, replyto: epicboxreplyto, createdat: new Date(), expiration:86400000, messageid:uid(32)  }).then((insertResult)=>{

                ws.send(JSON.stringify({type:"Ok"}));

                  // fast send if only one slate in database

                  // find message id send in Made message from vallet
                  collection.find({ queue: addressto.publicKey, made: false}).sort({ "createdat" : 1 }).toArray().then((findResult)=>{

                    if(findResult.length==1){


                      wss.clients.forEach(function each(client) {
                          if (client.readyState === 1 && client.queueforsubscribe!=null && client.queueforsubscribe==addressto.publicKey) {



                              statistics.slatesAttempt = statistics.slatesAttempt + 1
                              console.log("try check and send ", client.queueforsubscribe)


                              let fromrabbit =  JSON.parse(findResult[0].payload)
                              let answer= {}
                              answer.type="Slate"
                              answer.from = findResult[0].replyto
                              answer.str = fromrabbit.str
                              answer.signature = fromrabbit.signature
                              answer.challenge = fromrabbit.challenge

                              let answerstr = null

                              if(client.epicboxver == "2.0.0"){

                                      let messageid = findResult[0].messageid                           
                      
                                      answer.epicboxmsgid = messageid
                                      answer.ver = client.epicboxver
                                      answerstr = JSON.stringify(answer)                                                            
                                      client.send(answerstr)  
                                      console.log("Sent to 2.0.0 ", client.queueforsubscribe)

                              } else {

                                    answerstr = JSON.stringify(answer)                      
                                    client.send(answerstr)
                                    console.log("Looks sent to ", client.queueforsubscribe)                            
                                    collection.updateOne({messageid:findResult[0].messageid, made:false}, {$set:{made:true} }).then((updateResult)=>{


                                    });

                              }
                    

                          


                          }
                      })


                    }

                  })               

            }).catch((err)=>{
              
              ws.send(JSON.stringify({type:"Error", kind:"Slate send error", description:"Slate problem"}))              
              console.error(err)

            })



            
             
      } else {
        // connect by wss to other epicbox
        // when received Challange send by Message PostSlate Slate received from wallet.
        //
        //
		    sock = new WebSocket("wss://"+addressto.domain+":"+addressto.port)
        sock.on('error', console.error)
        sock.on('open', ()=>{console.log("Connect "+addressto.domain+":"+addressto.port)})
        sock.on('message',(mes)=>{
                	try{
				                ames = JSON.parse(mes)
                        if(ames.type=="Challenge") {
                            let reqqq = {type:"PostSlate", from:json.from, to:json.to, str:json.str, signature:json.signature}
                            sock.send(JSON.stringify(reqqq))

                            fs.writeFile('./test51pool.txt', JSON.stringify(reqqq), err => {
                              if (err) {
                                console.error(err);
                              }
                              // file written successfully
                            });

                            console.log("Send to wss://"+addressto.domain+":"+addressto.port)
			                  }
                        if(ames.type=="Ok") {
                         statistics.slatesRelayedInHour = statistics.slatesRelayedInHour + 1 
                         console.log("Sent correct to wss://"+addressto.domain+":"+addressto.port)
                          ws.send(JSON.stringify({type:"Ok"}));                
                        } 
		          
                  } catch(ee){
				            console.error(ee)
                    ws.send(JSON.stringify({type:"Error", kind:"Slate send error remote server", description:"Slate problem remote server"}));
                  }
        })
      }


}



//
//  function warking in interval repeted in 3 sec. after finish loop
//  it check all connected websockets to epicbox and if they are in Subscribe mode check if new Slate are waitng for it
//  if new slate is ... when send it.
//  check if wallet use 2.0.0 version 
//
function forInterval(){

    clearInterval(interval)

    let foractiveconnections = 0

    wss.clients.forEach(function each(client) {
      if (client.readyState === 1 && client.queueforsubscribe!=null) {
        foractiveconnections = foractiveconnections + 1
        //console.log("Checking ", client.queueforsubscribe)
        try {
              
                const db = mongoclient.db(dbName);
                const collection = db.collection(collectionname);    

               // find message id send in Made message from vallet
               collection.find({ queue: client.queueforsubscribe, made: false}).sort({ "createdat" : 1 }).limit(1).toArray().then((findResult)=>{


                   if(findResult.length>0) {

                      statistics.slatesAttempt = statistics.slatesAttempt + 1
                      console.log("try check and send ", client.queueforsubscribe)


                      let fromrabbit =  JSON.parse(findResult[0].payload)
                      let answer= {}
                      answer.type="Slate"
                      answer.from = findResult[0].replyto
                      answer.str = fromrabbit.str
                      answer.signature = fromrabbit.signature
                      answer.challenge = fromrabbit.challenge

                      let answerstr = null

                      if(client.epicboxver == "2.0.0"){

                              let messageid = findResult[0].messageid                           
              
                              answer.epicboxmsgid = messageid
                              answer.ver = client.epicboxver
                              answerstr = JSON.stringify(answer)                                                            
                              client.send(answerstr)  
                              console.log("Sent to 2.0.0 ", client.queueforsubscribe)

                      } else {

                            answerstr = JSON.stringify(answer)                      
                            client.send(answerstr)
                            console.log("Looks sent to ", client.queueforsubscribe)                            
                            collection.updateOne({messageid:findResult[0].messageid, made:false}, {$set:{made:true} }).then((updateResult)=>{


                            });

                      }
            

                    } else {
                      // console.log("msgrabbit ", msgrabbit)
                      //console.log("Error ", err)
                    } 


               }); 

            
        } catch(err){
          console.log(err)
        }
      
      }

    });

    statistics.activeconnections = foractiveconnections

    interval = setInterval( forInterval, intervalperiod);

}



function forIntervalChallenge(){

    console.log("Challenge Interval")

    wss.clients.forEach(function each(client) {
      if (client.readyState === 1 && client.queueforsubscribe!=null && client.epicboxver == "2.0.0") {
      
          try{

            client.send(JSON.stringify({"type": "Challenge","str": challenge}))

          } catch(err){

            console.log("Send Interval challenge error ", err)
          }
      }
    });


}



// must be replice
let changeStream;
async function run() {
  try {
    
    const db = mongoclient.db(dbName);
    const collection = db.collection(collectionname);    

    // Open a Change Stream on the "haikus" collection
    changeStream = collection.watch();
    // Print change events
    for await (const change of changeStream) {
      console.log("Received change:\n", change);
    }
    await changeStream.close();
    
  } finally {
    console.log("End")
  }
}


//
// main starting function
//
async function main() {

  await mongoclient.connect();
  console.log('Connected successfully to mongo');

  //run().catch(console.log);
    
  server.listen(localepicboxserviceport)
   
  interval = setInterval( forInterval, 2000);
  
  setInterval(forIntervalChallenge, 3*60*1000); 

  return "Epicbox ready to work.";

}


// We are using this single function to handle multiple signals
function handle(signal) {
  console.log(`So the signal which I have Received is: ${signal}`);


    wss.clients.forEach(function each(client) {
      
      client.close();

    });

    mongoclient.close();
    process.exit()

}
 
process.on('SIGINT', handle);
process.on('SIGBREAK', handle);
//process.on("SIGTERM", handle);
//process.on("SIGKILL", handle);


main()
  .then(console.log)
  .catch(console.error)

// That's all
// It is one day created software and seven days finding bugs :)))
// If you has suggestion or something is starnge for you simple ask me on keybase or telegram
// Thank you for reading. Sorry my English.



