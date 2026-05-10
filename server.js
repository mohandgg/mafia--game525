const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let rooms = {};

io.on('connection', (socket) => {
    // إنشاء غرفة
    socket.on('createRoom', (data) => {
        let roomCode = Math.floor(10000 + Math.random() * 90000).toString();
        rooms[roomCode] = {
            settings: data,
            players: [{ id: socket.id, name: data.name, role: '', isAlive: true }],
            phase: 'waiting'
        };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
        io.to(roomCode).emit('updatePlayers', rooms[roomCode].players);
    });

    // انضمام لاعب
    socket.on('joinRoom', (data) => {
        let room = rooms[data.code];
        if (room) {
            // منع تكرار نفس اللاعب
            if (!room.players.find(p => p.id === socket.id)) {
                room.players.push({ id: socket.id, name: data.name, role: '', isAlive: true });
                socket.join(data.code);
            }
            io.to(data.code).emit('updatePlayers', room.players);
        } else {
            socket.emit('notification', 'الغرفة غير موجودة!');
        }
    });

    // بداية اللعبة وتوزيع الأدوار
    socket.on('startGame', (roomCode) => {
        let room = rooms[roomCode];
        if (!room) return;
        
        let roles = [];
        for(let i=0; i<room.settings.mafia; i++) roles.push('مافيا');
        for(let i=0; i<room.settings.doctor; i++) roles.push('دكتور');
        for(let i=0; i<room.settings.detective; i++) roles.push('شايب');
        while(roles.length < room.players.length) roles.push('مواطن');
        
        roles.sort(() => Math.random() - 0.5);

        room.players.forEach((p, i) => {
            p.role = roles[i];
            io.to(p.id).emit('yourRole', p.role);
        });
        
        // إرسال تنبيه لبداية أول مرحلة
        io.to(roomCode).emit('changePhase', { 
            phase: 'ليل - المافيا', 
            players: room.players, 
            timer: room.settings.timer 
        });
    });
});

server.listen(process.env.PORT || 3000);
