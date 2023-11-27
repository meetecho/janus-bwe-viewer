'use strict';

/*
 * Author:    Lorenzo Miniero
 * Copyright: Meetecho
 *
 */

// Configuration
const config = require('./config.js');

// Debugging
const debug = require('debug');
const bwe = {
	debug: debug('bwe:debug'),
	error: debug('bwe:error'),
	warn: debug('bwe:warn'),
	timer: debug('bwe:timer'),
	info: debug('bwe:info')
};

// Connected clients
var clients = {}, id = 0;

// UDP socket
const dgram = require('dgram');
const socket = dgram.createSocket('udp4');
socket.on('error', err => {
	bwe.error('Socket error:', err);
	socket.close();
});
socket.on('message', msg => {
	bwe.debug('Got message:', msg);
	try {
		// Push to socket.io clients
		for(let id in clients) {
			let client = clients[id];
			if(client.bweLive)
				client.emit('stat', '' + msg);
		}
	} catch(err) {
		bwe.error(err);
	}
});
socket.bind({ port: config.udp_port, address: this.host }, () => {
	bwe.info('UDP server listening on *:' + config.udp_port);
});

// HTML + Socket.io
const fs = require('fs');
const express = require('express');
const app = express();
const http = require('http');
app.use(express.static('web'));
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);
io.on('connection', (socket) => {
	// TODO
	socket.bweId = ++id;
	bwe.info('A viewer connected (' + socket.bweId + ')');
	clients[id] = socket;
	socket.on('disconnecting', (reason) => {
		bwe.info('A viewer disconnected (' + socket.bweId + ', ' + reason + ')');
		delete clients[socket.bweId];
	});
	socket.on('context', (msg) => {
		if(msg === 'live') {
			// Viewer expects live stats
			socket.bweLive = true;
			bwe.info('Viewer ' + socket.bweId + ' expects live stats');
		} else {
			// Open an existing file and return it
			socket.bweLive = false;
			bwe.info('Viewer ' + socket.bweId + ' needs a file: ' + msg);
			try {
				let data = fs.readFileSync('./stats/' + msg, { flag: 'r' });
				socket.emit('csv', '' + data);
			} catch(err) {
				bwe.error('Error opening file ./stat/' + msg + ': ', err);
				socket.emit('error', 'Error opening file');
			}
		}
	});
});
server.on('error', function(err) {
	bwe.warn('API server error:', err)
	if(err.code == 'EADDRINUSE') {
		bwe.error('Port ' + config.api_port + ' for API server already in use');
	} else {
		bwe.error('Error creating API server:', err);
	}
});
server.listen(config.api_port, function() {
	bwe.info('API server listening on *:' + config.api_port);
});
