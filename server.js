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
            phase: 'waiting',
            actions: { kill: null, heal: null },
            votes: {}
        };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
        io.to(roomCode).emit('updatePlayers', rooms[roomCode].players);
    });

    // انضمام لاعب
    socket.on('joinRoom', (data) => {
        let room = rooms[data.code];
        if (room) {
            if (!room.players.find(p => p.id === socket.id)) {
                room.players.push({ id: socket.id, name: data.name, role: '', isAlive: true });
                socket.join(data.code);
            }
            io.to(data.code).emit('updatePlayers', room.players);
        } else {
            socket.emit('errorMsg', 'الغرفة غير موجودة');
        }
    });

    // كشف خروج اللاعب (لو طفى جواله)
    socket.on('disconnect', () => {
        for (let code in rooms) {
            let playerIndex = rooms[code].players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                let playerName = rooms[code].players[playerIndex].name;
                rooms[code].players.splice(playerIndex, 1);
                io.to(code).emit('updatePlayers', rooms[code].players);
                io.to(code).emit('notification', `اللاعب ${playerName} غادر اللعبة أو انقطع اتصاله ⚠️`);
            }
        }
    });

    // بداية اللعبة
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
        startNight(roomCode);
    });

    function startNight(roomCode) {
        let room = rooms[roomCode];
        if(!room) return;
        room.phase = 'night_mafia';
        io.to(roomCode).emit('changePhase', { phase: 'المافيا تختار 🔪', players: room.players.filter(p => p.isAlive), timer: room.settings.timer });
        
        // الانتقال التلقائي للشايب بعد انتهاء الوقت
        setTimeout(() => {
            io.to(roomCode).emit('changePhase', { phase: 'الشايب يحقق 🔍', players: room.players.filter(p => p.isAlive), timer: room.settings.timer });
            setTimeout(() => {
                io.to(roomCode).emit('changePhase', { phase: 'الدكتور يعالج 💊', players: room.players.filter(p => p.isAlive), timer: room.settings.timer });
                setTimeout(() => processDay(roomCode), room.settings.timer * 1000);
            }, room.settings.timer * 1000);
        }, room.settings.timer * 1000);
    }

    socket.on('mafiaAction', d => { rooms[d.roomCode].actions.kill = d.targetId; io.to(d.roomCode).emit('playSound', 'kill'); });
    socket.on('doctorAction', d => { rooms[d.roomCode].actions.heal = d.targetId; io.to(d.roomCode).emit('playSound', 'heal'); });
    socket.on('detectiveAction', d => { 
        let t = rooms[d.roomCode].players.find(p => p.id === d.targetId);
        socket.emit('notification', `دوره هو: ${t.role}`);
        socket.emit('playSound', 'write');
    });

    function processDay(roomCode) {
        let room = rooms[roomCode];
        let deadId = room.actions.kill !== room.actions.heal ? room.actions.kill : null;
        if(deadId) {
            let p = room.players.find(pl => pl.id === deadId);
            if(p) p.isAlive = false;
        }
        io.to(roomCode).emit('dayStarted', { dead: deadId, players: room.players });
        room.actions = { kill: null, heal: null };
    }

    socket.on('castVote', d => {
        let room = rooms[d.roomCode];
        room.votes[socket.id] = d.targetId;
        let total = Object.keys(room.votes).length;
        if(total >= room.players.filter(p => p.isAlive).length) {
            // حساب المطرود
            let counts = {};
            Object.values(room.votes).forEach(id => counts[id] = (counts[id] || 0) + 1);
            let kickedId = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
            let p = room.players.find(pl => pl.id === kickedId);
            if(p) p.isAlive = false;
            io.to(d.roomCode).emit('notification', `القرية طردت ${p ? p.name : 'لا أحد'}`);
            setTimeout(() => startNight(d.roomCode), 5000);
            room.votes = {};
        }
    });
});

server.listen(process.env.PORT || 3000);
