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
        if (room && !room.players.find(p => p.id === socket.id)) {
            room.players.push({ id: socket.id, name: data.name, role: '', isAlive: true });
            socket.join(data.code);
            io.to(data.code).emit('updatePlayers', room.players);
        }
    });

    // كشف خروج اللاعب (لو قفل الصفحة أو طفى جواله)
    socket.on('disconnect', () => {
        for (let code in rooms) {
            let room = rooms[code];
            let index = room.players.findIndex(p => p.id === socket.id);
            if (index !== -1) {
                let name = room.players[index].name;
                room.players.splice(index, 1);
                io.to(code).emit('updatePlayers', room.players);
                io.to(code).emit('notification', `اللاعب ${name} غادر اللعبة ⚠️`);
            }
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
        runGameLoop(roomCode);
    });

    // إدارة مراحل الليل (مافيا -> شايب -> دكتور)
    async function runGameLoop(roomCode) {
        let room = rooms[roomCode];
        let timer = room.settings.timer * 1000;

        // ليل المافيا
        io.to(roomCode).emit('changePhase', { phase: 'المافيا تختار 🔪', players: room.players.filter(p => p.isAlive), timer: room.settings.timer });
        await new Promise(r => setTimeout(r, timer));

        // ليل الشايب
        io.to(roomCode).emit('changePhase', { phase: 'الشايب يحقق 🔍', players: room.players.filter(p => p.isAlive), timer: room.settings.timer });
        await new Promise(r => setTimeout(r, timer));

        // ليل الدكتور
        io.to(roomCode).emit('changePhase', { phase: 'الدكتور يعالج 💊', players: room.players.filter(p => p.isAlive), timer: room.settings.timer });
        await new Promise(r => setTimeout(r, timer));

        processNightResults(roomCode);
    }

    // الأفعال
    socket.on('mafiaAction', d => { rooms[d.roomCode].actions.kill = d.targetId; io.to(d.roomCode).emit('playSound', 'kill'); });
    socket.on('doctorAction', d => { rooms[d.roomCode].actions.heal = d.targetId; io.to(d.roomCode).emit('playSound', 'heal'); });
    socket.on('detectiveAction', d => {
        let t = rooms[d.roomCode].players.find(p => p.id === d.targetId);
        socket.emit('notification', `الشخص المختص هو: ${t.role}`);
        socket.emit('playSound', 'write');
    });

    function processNightResults(roomCode) {
        let room = rooms[roomCode];
        let killed = (room.actions.kill !== room.actions.heal) ? room.actions.kill : null;
        if(killed) {
            let p = room.players.find(pl => pl.id === killed);
            if(p) p.isAlive = false;
        }
        io.to(roomCode).emit('dayStarted', { killed: killed, players: room.players });
        room.actions = { kill: null, heal: null };
    }

    socket.on('castVote', d => {
        let room = rooms[d.roomCode];
        room.votes[socket.id] = d.targetId;
        if(Object.keys(room.votes).length >= room.players.filter(p => p.isAlive).length) {
            let counts = {};
            Object.values(room.votes).forEach(id => counts[id] = (counts[id] || 0) + 1);
            let kickedId = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
            let p = room.players.find(pl => pl.id === kickedId);
            if(p) p.isAlive = false;
            io.to(d.roomCode).emit('notification', `القرية طردت: ${p.name}`);
            room.votes = {};
            setTimeout(() => runGameLoop(d.roomCode), 5000);
        }
    });
});

server.listen(process.env.PORT || 3000);
