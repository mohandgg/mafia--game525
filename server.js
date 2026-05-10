const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let rooms = {}; 

io.on('connection', (socket) => {
    // إنشاء الغرفة
    socket.on('createRoom', (data) => {
        let roomCode = Math.floor(10000 + Math.random() * 90000).toString();
        rooms[roomCode] = {
            settings: {
                max: parseInt(data.max) || 5,
                mafia: parseInt(data.mafia) || 1,
                doctor: parseInt(data.doctor) || 0,
                detective: parseInt(data.detective) || 0
            },
            players: [{ id: socket.id, name: data.name, role: '', isAlive: true }],
            history: { lastHealed: null }
        };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
        socket.emit('updatePlayers', rooms[roomCode].players);
    });

    // الانضمام
    socket.on('joinRoom', (data) => {
        if (rooms[data.code]) {
            rooms[data.code].players.push({ id: socket.id, name: data.name, role: '', isAlive: true });
            socket.join(data.code);
            io.to(data.code).emit('updatePlayers', rooms[data.code].players);
        } else {
            socket.emit('error', 'الكود غلط يا وحش!');
        }
    });

    // بدء اللعبة (هنا كان الخطأ اللي يطفي الموقع)
    socket.on('startGame', (roomCode) => {
        if (!rooms[roomCode]) return;
        
        let room = rooms[roomCode];
        let pList = room.players;
        let s = room.settings;

        let roles = [];
        for(let i=0; i<s.mafia; i++) roles.push('مافيا 🔪');
        for(let i=0; i<s.doctor; i++) roles.push('دكتور 💉');
        for(let i=0; i<s.detective; i++) roles.push('شايب 🕵️‍♂️');
        while(roles.length < pList.length) roles.push('مواطن 👤');
        
        roles.sort(() => Math.random() - 0.5);

        pList.forEach((p, i) => {
            p.role = roles[i];
            io.to(p.id).emit('yourRole', p.role);
        });

        console.log("انطلقت اللعبة في غرفة: " + roomCode);
    });
});

server.listen(3000, () => {
    console.log('سيرفر المافيا شغال! الرابط: http://localhost:3000');
});