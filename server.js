const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let rooms = {};

io.on('connection', (socket) => {
    socket.on('createRoom', (data) => {
        let roomCode = Math.floor(10000 + Math.random() * 90000).toString();
        rooms[roomCode] = {
            settings: data, // يحتوي على عدد الثواني والأدوار
            players: [{ id: socket.id, name: data.name, role: '', isAlive: true }],
            phase: 'waiting',
            actions: { kill: null, heal: null, check: null },
            history: { lastHealed: null },
            votes: {}
        };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
        io.to(roomCode).emit('updatePlayers', rooms[roomCode].players);
    });

    socket.on('joinRoom', (data) => {
        if (rooms[data.code]) {
            rooms[data.code].players.push({ id: socket.id, name: data.name, role: '', isAlive: true });
            socket.join(data.code);
            io.to(data.code).emit('updatePlayers', rooms[data.code].players);
        }
    });

    socket.on('startGame', (roomCode) => {
        let room = rooms[roomCode];
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
        startPhase(roomCode, 'night_mafia');
    });

    function startPhase(roomCode, phase) {
        let room = rooms[roomCode];
        room.phase = phase;
        let duration = room.settings.timer * 1000;
        let phaseName = phase === 'night_mafia' ? 'ليل - المافيا' : (phase === 'night_detective' ? 'ليل - الشايب' : 'ليل - الدكتور');
        
        io.to(roomCode).emit('changePhase', { 
            phase: phaseName, 
            players: room.players.filter(p => p.isAlive),
            timer: room.settings.timer 
        });

        setTimeout(() => {
            if (phase === 'night_mafia') startPhase(roomCode, 'night_detective');
            else if (phase === 'night_detective') startPhase(roomCode, 'night_doctor');
            else startDayPhase(roomCode);
        }, duration);
    }

    // استلام الأفعال (قتل، حماية، سؤال)
    socket.on('mafiaAction', d => { rooms[d.roomCode].actions.kill = d.targetId; io.to(d.roomCode).emit('playSound', 'kill'); });
    socket.on('detectiveAction', d => { rooms[d.roomCode].actions.check = d.targetId; socket.emit('playSound', 'write'); });
    socket.on('doctorAction', d => { rooms[d.roomCode].actions.heal = d.targetId; io.to(d.roomCode).emit('playSound', 'heal'); });

    function startDayPhase(roomCode) {
        let room = rooms[roomCode];
        let msg = "طلع النهار.. ";
        if(room.actions.kill !== room.actions.heal) {
            let p = room.players.find(pl => pl.id === room.actions.kill);
            p.isAlive = false;
            msg += "مات " + p.name;
        } else { msg += "لم يمت أحد!"; }
        
        io.to(roomCode).emit('dayStarted', { message: msg, players: room.players });
        room.actions = { kill: null, heal: null, check: null };
    }

    socket.on('castVote', d => {
        let room = rooms[d.roomCode];
        room.votes[socket.id] = d.targetId;
        io.to(d.roomCode).emit('notification', 'تم تسجيل صوت جديد');
    });
});

server.listen(process.env.PORT || 3000);
