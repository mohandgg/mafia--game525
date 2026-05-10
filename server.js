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
            host: socket.id,
            settings: data,
            players: [{ id: socket.id, name: data.name, role: '', isAlive: true, lastProtected: null }],
            phase: 'waiting',
            actions: { kill: null, heal: null },
            votes: {},
            timerObj: null
        };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
        io.to(roomCode).emit('updatePlayers', rooms[roomCode].players);
    });

    socket.on('joinRoom', (data) => {
        let room = rooms[data.code];
        if (room && !room.players.some(p => p.name === data.name)) {
            room.players.push({ id: socket.id, name: data.name, role: '', isAlive: true, lastProtected: null });
            socket.join(data.code);
            io.to(data.code).emit('updatePlayers', room.players);
        } else {
            socket.emit('uiLog', 'الاسم مستخدم أو الغرفة غير موجودة');
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
        startNight(roomCode);
    });

    function startNight(roomCode) {
        let room = rooms[roomCode];
        if(!room || checkWin(roomCode)) return;
        room.actions = { kill: null, heal: null };
        runPhase(roomCode, 'night_mafia', 'ليل - دور المافيا 🔪');
    }

    function runPhase(roomCode, phase, label) {
        let room = rooms[roomCode];
        room.phase = phase;
        
        // تحديد من هو "قائد المافيا" الحالي (أول مافيا حي)
        let mafiaLeader = room.players.find(p => p.role === 'مافيا' && p.isAlive);
        
        io.to(roomCode).emit('changePhase', { 
            phase: label, 
            players: room.players.filter(p=>p.isAlive), 
            timer: room.settings.timer,
            mafiaLeaderId: mafiaLeader ? mafiaLeader.id : null 
        });

        clearTimeout(room.timerObj);
        room.timerObj = setTimeout(() => nextPhase(roomCode), room.settings.timer * 1000);
    }

    function nextPhase(roomCode) {
        let room = rooms[roomCode];
        if(!room) return;
        io.to(roomCode).emit('playBell'); 
        
        if (room.phase === 'night_mafia') runPhase(roomCode, 'night_detective', 'ليل - دور الشايب 🔍');
        else if (room.phase === 'night_detective') runPhase(roomCode, 'night_doctor', 'ليل - دور الدكتور 💊');
        else if (room.phase === 'night_doctor') calculateDay(roomCode);
    }

    socket.on('mafiaAction', d => { 
        rooms[d.roomCode].actions.kill = d.targetId; 
        nextPhase(d.roomCode); 
    });

    socket.on('doctorAction', d => {
        let room = rooms[d.roomCode];
        let p = room.players.find(pl => pl.id === socket.id);
        if (p.lastProtected === d.targetId) return socket.emit('uiLog', 'حميته الجولة اللي راحت! اختر غيره');
        room.actions.heal = d.targetId;
        p.lastProtected = d.targetId;
        nextPhase(d.roomCode);
    });

    socket.on('detectiveAction', d => {
        let target = rooms[d.roomCode].players.find(p => p.id === d.targetId);
        socket.emit('uiLog', `التحقيق: ${target.name} هو ${target.role === 'مافيا' ? 'مافيا 💀' : 'مواطن ✅'}`);
        nextPhase(d.roomCode);
    });

    function calculateDay(roomCode) {
        let room = rooms[roomCode];
        let killedId = (room.actions.kill !== room.actions.heal) ? room.actions.kill : null;
        if(killedId) room.players.find(p=>p.id===killedId).isAlive = false;
        
        let msg = killedId ? `طلع النهار.. مات ${room.players.find(p=>p.id===killedId).name}` : "طلع النهار.. وما مات أحد!";
        io.to(roomCode).emit('dayStarted', { msg, players: room.players.filter(p=>p.isAlive), dayTimer: room.settings.dayTimer });
        checkWin(roomCode);
    }

    function checkWin(roomCode) {
        let room = rooms[roomCode];
        let alive = room.players.filter(p => p.isAlive);
        let mafiaCount = alive.filter(p => p.role === 'مافيا').length;
        let othersCount = alive.length - mafiaCount;

        if (mafiaCount === 0) {
            io.to(roomCode).emit('gameOver', { winner: 'المواطنين ✅', players: room.players });
            return true;
        } else if (mafiaCount >= othersCount) {
            io.to(roomCode).emit('gameOver', { winner: 'المافيا 💀', players: room.players });
            return true;
        }
        return false;
    }

    socket.on('castVote', d => {
        let room = rooms[d.roomCode];
        room.votes[socket.id] = d.targetId;
        if (Object.keys(room.votes).length >= room.players.filter(p=>p.isAlive).length) {
            let counts = {};
            Object.values(room.votes).forEach(id => { if(id !== 'skip') counts[id] = (counts[id] || 0) + 1 });
            let sorted = Object.keys(counts).sort((a,b) => counts[b] - counts[a]);
            
            if (sorted.length === 0 || (sorted.length > 1 && counts[sorted[0]] === counts[sorted[1]])) {
                io.to(d.roomCode).emit('uiLog', "تعادل! لا يوجد طرد.");
                room.votes = {};
                setTimeout(() => startNight(d.roomCode), 3000);
            } else {
                io.to(d.roomCode).emit('defensePhase', { targetId: sorted[0], targetName: room.players.find(p=>p.id===sorted[0]).name, time: room.settings.defTimer });
            }
        }
    });

    socket.on('finalDecision', d => {
        let room = rooms[d.roomCode];
        if (d.decision === 'kill') {
            room.players.find(p => p.id === d.targetId).isAlive = false;
            io.to(d.roomCode).emit('uiLog', `تم طرد ${room.players.find(p => p.id === d.targetId).name}`);
        }
        room.votes = {};
        if(!checkWin(d.roomCode)) setTimeout(() => startNight(d.roomCode), 3000);
    });
});

server.listen(process.env.PORT || 3000);
