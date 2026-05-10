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
            players: [],
            phase: 'waiting', // waiting, night_mafia, night_detective, night_doctor, day_discussion, voting
            actions: { kill: null, heal: null, check: null },
            history: { lastHealed: null },
            votes: {}
        };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
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
        // توزيع الأدوار عشوائياً
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

        // بعد 5 ثواني تبدأ مرحلة المافيا
        setTimeout(() => startMafiaPhase(roomCode), 5000);
    });

    function startMafiaPhase(roomCode) {
        let room = rooms[roomCode];
        room.phase = 'night_mafia';
        io.to(roomCode).emit('changePhase', { phase: 'ليل - المافيا تختار', players: room.players.filter(p => p.isAlive) });
    }

    socket.on('mafiaAction', (data) => {
        let room = rooms[data.roomCode];
        room.actions.kill = data.targetId;
        io.to(data.roomCode).emit('notification', 'المافيا نفذت العملية');
        setTimeout(() => startDetectivePhase(data.roomCode), 5000);
    });

    function startDetectivePhase(roomCode) {
        let room = rooms[roomCode];
        room.phase = 'night_detective';
        io.to(roomCode).emit('changePhase', { phase: 'ليل - الشايب يسأل', players: room.players.filter(p => p.isAlive) });
    }

    socket.on('detectiveAction', (data) => {
        let room = rooms[data.roomCode];
        let target = room.players.find(p => p.id === data.targetId);
        socket.emit('notification', `النتيجة: هذا الشخص ${target.role === 'مافيا' ? 'مافيا 💀' : 'مواطن ✅'}`);
        setTimeout(() => startDoctorPhase(data.roomCode), 5000);
    });

    function startDoctorPhase(roomCode) {
        let room = rooms[roomCode];
        room.phase = 'night_doctor';
        io.to(roomCode).emit('changePhase', { phase: 'ليل - الدكتور يحمي', players: room.players.filter(p => p.isAlive) });
    }

    socket.on('doctorAction', (data) => {
        let room = rooms[data.roomCode];
        if (room.history.lastHealed === data.targetId) {
            return socket.emit('error', 'ما تقدر تحمي نفس الشخص مرتين ورا بعض!');
        }
        room.actions.heal = data.targetId;
        room.history.lastHealed = data.targetId;
        io.to(data.roomCode).emit('notification', 'الدكتور خلص شغله');
        setTimeout(() => startDayPhase(data.roomCode), 5000);
    });

    function startDayPhase(roomCode) {
        let room = rooms[roomCode];
        let killedId = room.actions.kill;
        let healedId = room.actions.heal;

        let message = "النهار طلع.. ";
        if (killedId && killedId !== healedId) {
            let player = room.players.find(p => p.id === killedId);
            player.isAlive = false;
            message += `وللأسف مات ${player.name} 💀`;
        } else {
            message += "وما مات أحد! الدكتور بطل 🔥";
        }

        io.to(roomCode).emit('dayStarted', { message, players: room.players });
        checkWinCondition(roomCode);
    }

    function checkWinCondition(roomCode) {
        let room = rooms[roomCode];
        let aliveMafia = room.players.filter(p => p.isAlive && p.role === 'مافيا').length;
        let aliveOthers = room.players.filter(p => p.isAlive && p.role !== 'مافيا').length;

        if (aliveMafia === 0) {
            io.to(roomCode).emit('gameOver', 'المواطنين فازوا! 🎉');
        } else if (aliveMafia >= aliveOthers) {
            io.to(roomCode).emit('gameOver', 'المافيا فازوا! 🔪');
        }
    }
});

server.listen(process.env.PORT || 3000);