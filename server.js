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
            settings: data,
            players: [{ id: socket.id, name: data.name, role: '', isAlive: true }],
            phase: 'waiting',
            actions: { kill: null, heal: null, check: null },
            votes: {}, // لتخزين الأصوات: { voterId: targetId }
            history: { lastHealed: null }
        };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
        io.to(roomCode).emit('updatePlayers', rooms[roomCode].players);
    });

    // الانضمام للغرفة مع منع التكرار
    socket.on('joinRoom', (data) => {
        let room = rooms[data.code];
        if (room) {
            // منع دخول نفس الشخص مرتين
            if (!room.players.find(p => p.id === socket.id)) {
                room.players.push({ id: socket.id, name: data.name, role: '', isAlive: true });
                socket.join(data.code);
            }
            io.to(data.code).emit('updatePlayers', room.players);
        }
    });

    // التصويت
    socket.on('castVote', (data) => {
        let room = rooms[data.roomCode];
        if (room) {
            room.votes[socket.id] = data.targetId;
            let totalVotes = Object.keys(room.votes).length;
            let alivePlayers = room.players.filter(p => p.isAlive).length;

            // إذا الكل صوت، نحسب النتيجة فوراً
            if (totalVotes >= alivePlayers) {
                processVotingResult(data.roomCode);
            }
        }
    });

    function processVotingResult(roomCode) {
        let room = rooms[roomCode];
        let voteCounts = {};
        
        Object.values(room.votes).forEach(targetId => {
            voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
        });

        // إيجاد الشخص الأكثر تصويتاً
        let kickedId = Object.keys(voteCounts).reduce((a, b) => voteCounts[a] > voteCounts[b] ? a : b);
        let kickedPlayer = room.players.find(p => p.id === kickedId);
        
        if (kickedPlayer) {
            kickedPlayer.isAlive = false;
            io.to(roomCode).emit('votingResult', { 
                message: `تم طرد ${kickedPlayer.name} من القرية! 💀`,
                players: room.players 
            });
        }
        room.votes = {}; // تصقير الأصوات للجولة الجاية
        // العودة لليل بعد 5 ثواني
        setTimeout(() => startNightCycle(roomCode), 5000);
    }
    
    // الأفعال (القتل والحماية) تشغل أصوات عند الجميع
    socket.on('mafiaAction', d => { rooms[d.roomCode].actions.kill = d.targetId; io.to(d.roomCode).emit('playSound', 'kill'); });
    socket.on('doctorAction', d => { rooms[d.roomCode].actions.heal = d.targetId; io.to(d.roomCode).emit('playSound', 'heal'); });
    socket.on('detectiveAction', d => { rooms[d.roomCode].actions.check = d.targetId; socket.emit('playSound', 'write'); });

    // باقي منطق startGame و startPhase يبقى كما هو...
});

server.listen(process.env.PORT || 3000);
