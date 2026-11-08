// Preload that makes any network use in this process throw, so an offline step proves it is
// offline instead of merely not having tried. Local pipes and child processes still work.
// Use: node --import ./tests/helpers/no-network.mjs <script>
import dgram from "node:dgram";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

const refuse = (what) =>
  function () {
    throw new Error(`Network access (${what}) during an offline step`);
  };

net.Socket.prototype.connect = refuse("net.Socket.connect");
net.connect = net.createConnection = refuse("net.connect");
tls.connect = refuse("tls.connect");
http.request = http.get = refuse("http.request");
https.request = https.get = refuse("https.request");
dgram.createSocket = refuse("dgram.createSocket");
for (const name of ["lookup", "resolve", "resolve4", "resolve6", "resolveAny"]) {
  dns[name] = refuse(`dns.${name}`);
  dns.promises[name] = refuse(`dns.promises.${name}`);
}
globalThis.fetch = refuse("fetch");
globalThis.WebSocket = refuse("WebSocket");
