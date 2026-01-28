const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

app.get('/', (req, res) => {
    res.send("🚀 Ludo Sunucusu (Hazır Olma Özellikli) Aktif!");
});

const io = new Server(server, { 
    cors: { 
        origin: "*", 
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

let rooms = {}; 
const COLORS = ['red', 'green', 'yellow', 'blue']; 

// --- YARDIMCI FONKSİYONLAR ---

function getRoomList() {
    let roomList = [];
    for (const [id, room] of Object.entries(rooms)) {
        if (room.players.length < room.maxPlayers && !room.isGameStarted) {
            roomList.push({
                roomId: id,
                playerCount: room.players.length,
                maxPlayers: room.maxPlayers
            });
        }
    }
    return roomList;
}

// Oyuncu listesini oluşturup istemcilere gönder
function broadcastPlayerUpdate(roomId) {
    if (!rooms[roomId]) return;
    const room = rooms[roomId];
    
    // Sadece ID değil, durum bilgisini de içeren liste oluştur
    const playerList = room.players.map(pid => ({
        id: pid,
        isReady: room.readyStates[pid] || false,
        name: "Oyuncu", // İsim şimdilik varsayılan (İstersen join'de isim alabiliriz)
        avatar: "assets/avatars/avatar_1.png"
    }));

    io.to(roomId).emit('player_update', { players: playerList });
}

io.on('connection', (socket) => {
    console.log('Yeni Oyuncu:', socket.id);
    socket.emit('room_list_update', getRoomList());

    socket.on('get_room_list', () => {
        socket.emit('room_list_update', getRoomList());
    });

    // --- ODA OLUŞTURMA ---
    socket.on('create_room', (data) => {
        const roomId = Math.floor(100000 + Math.random() * 900000).toString();
        const capacity = data && data.maxPlayers ? data.maxPlayers : 4;

        rooms[roomId] = {
            players: [socket.id],
            readyStates: { [socket.id]: false }, // Hazır durumları
            maxPlayers: capacity, 
            currentTurnIndex: 0,
            badLuckCounters: {},
            isGameStarted: false
        };

        socket.join(roomId);
        socket.emit('room_created', { roomId: roomId });
        broadcastPlayerUpdate(roomId); // Oyuncuyu kendine göster
        io.emit('room_list_update', getRoomList());
    });

    // --- ODAYA KATILMA ---
    socket.on('join_game', (data) => {
        const { roomId } = data;
        if (rooms[roomId]) {
            const room = rooms[roomId];
            
            if (room.players.length >= room.maxPlayers && !room.players.includes(socket.id)) {
                socket.emit('error', { message: 'Oda dolu!' });
                return;
            }

            if (!room.players.includes(socket.id)) {
                room.players.push(socket.id);
                room.readyStates[socket.id] = false; // Yeni gelen hazır değil
            }
            
            socket.join(roomId);
            socket.emit('room_joined', { roomId: roomId });
            
            // Tüm odaya güncel listeyi duyur
            broadcastPlayerUpdate(roomId);
            io.emit('room_list_update', getRoomList());

        } else {
            socket.emit('error', { message: 'Böyle bir oda bulunamadı!' });
        }
    });

    // 🔥🔥 EKLENEN KRİTİK KISIM: HAZIR OLMA DURUMU 🔥🔥
    socket.on('toggle_ready', (data) => {
        const { roomId } = data;
        if (rooms[roomId]) {
            const room = rooms[roomId];
            // Durumu tersine çevir (True <-> False)
            room.readyStates[socket.id] = !room.readyStates[socket.id];
            
            console.log(`Oyuncu ${socket.id} hazır durumu: ${room.readyStates[socket.id]}`);
            
            // Herkese güncel durumu bildir (Yeşil tik çıksın diye)
            broadcastPlayerUpdate(roomId);
        }
    });

    // --- OYUNU BAŞLAT ---
    socket.on('start_game_command', (data) => {
        const { roomId } = data;
        if(rooms[roomId]) {
            const room = rooms[roomId];
            
            // Güvenlik: Herkes hazır mı? (İstersen bu kontrolü kapatabilirsin)
            const allReady = room.players.every(pid => room.readyStates[pid]);
            if (!allReady && room.players.length > 1) {
                // socket.emit('error', { message: 'Herkes hazır olmalı!' });
                // return; 
            }

            room.isGameStarted = true;
            room.players.forEach(pid => {
                if(!room.badLuckCounters) room.badLuckCounters = {};
                room.badLuckCounters[pid] = 0;
            });

            const clients = io.sockets.adapter.rooms.get(roomId);
            if (clients) {
                let index = 0;
                for (const clientId of clients) {
                    const clientSocket = io.sockets.sockets.get(clientId);
                    if (clientSocket) {
                        const myColor = COLORS[index];
                        clientSocket.emit('game_launch', { 
                            yourColor: myColor, 
                            roomId: roomId,
                            playerCount: room.maxPlayers 
                        });
                    }
                    index++;
                }
            }
            io.emit('room_list_update', getRoomList());
        }
    });

    // --- OYUN İÇİ EYLEMLER ---
    socket.on('send_chat_message', (data) => {
        io.to(data.roomId).emit('receive_chat_message', {
            senderId: socket.id,
            senderName: data.senderName,
            text: data.text
        });
    });

    socket.on('roll_dice', (data) => {
        const { roomId } = data;
        if (rooms[roomId]) {
            const room = rooms[roomId];
            const playerId = socket.id;

            if (!room.badLuckCounters) room.badLuckCounters = {};
            if (room.badLuckCounters[playerId] === undefined) room.badLuckCounters[playerId] = 0;

            let diceValue;
            if (room.badLuckCounters[playerId] >= 5) {
                diceValue = 6;
                room.badLuckCounters[playerId] = 0; 
            } else {
                diceValue = Math.floor(Math.random() * 6) + 1;
                if (diceValue === 6) room.badLuckCounters[playerId] = 0;
                else room.badLuckCounters[playerId]++;
            }
            io.to(roomId).emit('dice_rolled', { value: diceValue });
        }
    });

    socket.on('move_pawn', (data) => io.to(data.roomId).emit('pawn_moved', data));
    
    socket.on('pass_turn', (data) => {
         if (rooms[data.roomId]) {
            const room = rooms[data.roomId];
            room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length; 
            io.to(data.roomId).emit('turn_changed', { currentTurn: COLORS[room.currentTurnIndex] });
        }
    });

    socket.on('disconnect', () => {
        console.log("Kopan Oyuncu:", socket.id);
        let listChanged = false;
        for (const [id, room] of Object.entries(rooms)) {
            if (room.players.includes(socket.id)) {
                room.players = room.players.filter(pid => pid !== socket.id);
                delete room.readyStates[socket.id]; // Hazır kaydını da sil
                listChanged = true;
                
                if (room.players.length === 0) {
                    delete rooms[id];
                } else {
                    broadcastPlayerUpdate(id); // Kalanlara bildir
                    
                    if (room.isGameStarted) {
                         const remainingIndex = 0; 
                         const winnerColor = COLORS[remainingIndex];
                         io.to(id).emit('game_over_by_disconnect', { winner: winnerColor });
                         delete rooms[id]; 
                    }
                }
            }
        }
        if (listChanged) io.emit('room_list_update', getRoomList());
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor...`);
});
