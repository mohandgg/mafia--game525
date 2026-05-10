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
            settings: data,
            players: [{ id: socket.id, name: data.name, role: '', isAlive: true }],
            phase: 'waiting',
            actions: { kill: null, heal: null, check: null },
            votes: {}
        };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
        io.to(roomCode).emit('updatePlayers', rooms[roomCode].players);
    });

    socket.on('joinRoom', (data) => {
        let room = rooms[data.code];
        if (room && !room.players.find(p => p.id === socket.id)) {
            room.players.push({ id: socket.id, name: data.name, role: '', isAlive: true });
            socket.join(data.code);
            io.to(data.code).emit('updatePlayers', room.players);
        }
    });

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
        startNightCycle(roomCode);
    });

    function startNightCycle(roomCode) {
        let room = rooms[roomCode];
        // مرحلة المافيا
        io.to(roomCode).emit('changePhase', { 
            phase: 'ليل - المافيا تختار ضحيتها', 
            players: room.players.filter(p => p.isAlive), 
            timer: room.settings.timer 
        });

        setTimeout(() => {
            // مرحلة الشايب
            io.to(roomCode).emit('changePhase', { 
                phase: 'ليل - الشايب يحقق', 
                players: room.players.filter(p => p.isAlive), 
                timer: room.settings.timer 
            });
            
            setTimeout(() => {
                // مرحلة الدكتور
                io.to(roomCode).emit('changePhase', { 
                    phase: 'ليل - الدكتور يعالج', 
                    players: room.players.filter(p => p.isAlive), 
                    timer: room.settings.timer 
                });

                setTimeout(() => startDay(roomCode), room.settings.timer * 1000);
            }, room.settings.timer * 1000);
        }, room.settings.timer * 1000);
    }

    function startDay(roomCode) {
        let room = rooms[roomCode];
        let victimId = room.actions.kill;
        let savedId = room.actions.heal;
        let msg = "طلع النهار.. ";

        if (victimId && victimId !== savedId) {
            let p = room.players.find(pl => pl.id === victimId);
            if(p) { p.isAlive = false; msg += "مات المسكين " + p.name; }
        } else {
            msg += "الحمد لله، ما مات أحد اليوم!";
        }

        io.to(roomCode).emit('dayStarted', { message: msg, players: room.players.filter(p => p.isAlive) });
        room.actions = { kill: null, heal: null, check: null };
        room.votes = {};
    }

    socket.on('mafiaAction', d => { rooms[d.roomCode].actions.kill = d.targetId; io.to(d.roomCode).emit('playSound', 'kill'); });
    socket.on('doctorAction', d => { rooms[d.roomCode].actions.heal = d.targetId; io.to(d.roomCode).emit('playSound', 'heal'); });
    socket.on('detectiveAction', d => { 
        let target = rooms[d.roomCode].players.find(p => p.id === d.targetId);
        socket.emit('notification', `هذا الشخص هو: ${target.role}`);
        socket.emit('playSound', 'write');
    });

    socket.on('castVote', d => {
        let room = rooms[d.roomCode];
        room.votes[socket.id] = d.targetId;
        let totalVotes = Object.keys(room.votes).length;
        if(totalVotes >= room.players.filter(p => p.isAlive).length) {
            // منطق حساب المطرود (الأكثر تصويتاً)
            let counts = {};
            Object.values(room.votes).forEach(id => counts[id] = (counts[id] || 0) + 1);
            let kickedId = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
            let kickedP = room.players.find(p => p.id === kickedId);
            kickedP.isAlive = false;
            io.to(d.roomCode).emit('notification', `القرية قررت طرد: ${kickedP.name}`);
            setTimeout(() => startNightCycle(d.roomCode), 5000);
        }
    });
});
server.listen(process.env.PORT || 3000);
