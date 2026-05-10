const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let rooms = {};

io.on('connection', (socket) => {
    // 1. إنشاء الغرفة
    socket.on('createRoom', (data) => {
        let roomCode = Math.floor(10000 + Math.random() * 90000).toString();
        rooms[roomCode] = {
            host: socket.id,
            settings: data,
            players: [{ id: socket.id, name: data.name, role: '', isAlive: true, lastProtected: null }],
            phase: 'waiting',
            actions: { kill: null, heal: null },
            votes: {}
        };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode); // نرسل الكود لصاحب الروم
        io.to(roomCode).emit('updatePlayers', rooms[roomCode].players); // نحدث القائمة للكل
    });

    // 2. انضمام لاعب (هنا حل المشكلة اللي قلت عنها)
    socket.on('joinRoom', (data) => {
        let room = rooms[data.code];
        if (room) {
            // منع تكرار الاسم
            if (room.players.some(p => p.name === data.name)) {
                return socket.emit('uiLog', 'الاسم مستخدم بالفعل!');
            }
            
            room.players.push({ id: socket.id, name: data.name, role: '', isAlive: true, lastProtected: null });
            socket.join(data.code);
            
            // إرسال تأكيد للانضمام للشخص اللي دخل عشان تتغير شاشته
            socket.emit('joinedSuccessfully', data.code); 
            
            // تحديث القائمة عند الكل في الغرفة
            io.to(data.code).emit('updatePlayers', room.players);
        } else {
            socket.emit('uiLog', 'الغرفة غير موجودة!');
        }
    });

    // 3. خروج اللاعب
    socket.on('disconnect', () => {
        for (let code in rooms) {
            let room = rooms[code];
            let index = room.players.findIndex(p => p.id === socket.id);
            if (index !== -1) {
                let name = room.players[index].name;
                room.players.splice(index, 1);
                io.to(code).emit('updatePlayers', room.players);
                io.to(code).emit('uiLog', `غادر ${name} اللعبة`);
            }
        }
    });

    // 4. بدء اللعبة (التأكد من الكود)
    socket.on('startGame', (roomCode) => {
        let room = rooms[roomCode];
        if (!room || socket.id !== room.host) return;

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
        room.actions = { kill: null, heal: null };
        runPhase(roomCode, 'night_mafia', 'دور المافيا 🔪');
    }

    function runPhase(roomCode, phase, label) {
        let room = rooms[roomCode];
        room.phase = phase;
        let mafiaLeader = room.players.find(p => p.role === 'مافيا' && p.isAlive);
        
        io.to(roomCode).emit('changePhase', { 
            phase: label, 
            players: room.players.filter(p=>p.isAlive), 
            timer: room.settings.timer,
            mafiaLeaderId: mafiaLeader ? mafiaLeader.id : null
        });
    }

    socket.on('mafiaAction', d => { 
        rooms[d.roomCode].actions.kill = d.targetId; 
        io.to(d.roomCode).emit('playBell');
        runPhase(d.roomCode, 'night_detective', 'دور الشايب 🔍');
    });

    socket.on('detectiveAction', d => {
        let target = rooms[d.roomCode].players.find(p => p.id === d.targetId);
        socket.emit('uiLog', `التحقيق: ${target.name} هو ${target.role === 'مافيا' ? 'مافيا 💀' : 'مواطن ✅'}`);
        io.to(d.roomCode).emit('playBell');
        runPhase(d.roomCode, 'night_doctor', 'دور الدكتور 💊');
    });

    socket.on('doctorAction', d => {
        let room = rooms[d.roomCode];
        room.actions.heal = d.targetId;
        io.to(d.roomCode).emit('playBell');
        calculateDay(d.roomCode);
    });

    function calculateDay(roomCode) {
        let room = rooms[roomCode];
        let killedId = (room.actions.kill !== room.actions.heal) ? room.actions.kill : null;
        if(killedId) room.players.find(p=>p.id===killedId).isAlive = false;
        
        let msg = killedId ? `مات اللاعب ${room.players.find(p=>p.id===killedId).name}` : "لم يمت أحد!";
        io.to(roomCode).emit('dayStarted', { msg, players: room.players.filter(p=>p.isAlive), dayTimer: room.settings.dayTimer });
        checkWin(roomCode);
    }

    function checkWin(roomCode) {
        let room = rooms[roomCode];
        let alive = room.players.filter(p => p.isAlive);
        let mafiaCount = alive.filter(p => p.role === 'مافيا').length;
        let othersCount = alive.length - mafiaCount;

        if (mafiaCount === 0) {
            io.to(roomCode).emit('gameOver', 'فاز المواطنون! ✅');
            return true;
        } else if (mafiaCount >= othersCount) {
            io.to(roomCode).emit('gameOver', 'فاز المافيا! 💀');
            return true;
        }
        return false;
    }
});

server.listen(process.env.PORT || 3000);
