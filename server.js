const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// 🔥 Render'da tarayıcıdan girince sunucunun çalıştığını görmek için:
app.get('/', (req, res) => {
    res.send("🚀 Ludo Sunucusu Aktif ve Çalışıyor!");
});

// 🔥 Socket.io Ayarları (Bağlantı kopmalarını önlemek için ping ayarları eklendi)
const io = new Server(server, { 
    cors: { 
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000, // 60 saniye boyunca yanıt gelmezse kapat (Render için iyi)
    pingInterval: 25000 // 25 saniyede bir kontrol et
});

let rooms = {}; 
const COLORS = ['red', 'green', 'yellow', 'blue']; 

io.on('connection', (socket) => {
    console.log('Yeni Oyuncu Bağlandı:', socket.id);

    // --- ODA OLUŞTURMA ---
    socket.on('create_room', (data) => {
        const roomId = Math.floor(100000 + Math.random() * 900000).toString();
        const capacity = data && data.maxPlayers ? data.maxPlayers : 4;

        rooms[roomId] = {
            players: [socket.id],
            maxPlayers: capacity, 
            currentTurnIndex: 0,
            badLuckCounters: {} 
        };

        socket.join(roomId);
        console.log(`Oda Kuruldu: ${roomId} (Kapasite: ${capacity})`);
        socket.emit('room_created', { roomId: roomId });
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
            }
            
            socket.join(roomId);
            socket.emit('room_joined', { roomId: roomId });
            io.to(roomId).emit('player_joined_room', { count: room.players.length });

        } else {
            socket.emit('error', { message: 'Böyle bir oda bulunamadı!' });
        }
    });

    // --- OYUNU BAŞLAT ---
    socket.on('start_game_command', (data) => {
        const { roomId } = data;
        if(rooms[roomId]) {
            const room = rooms[roomId];
            // Şans sayaçlarını sıfırla
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
        }
    });

    // --- SOHBET MESAJI İLETİMİ ---
    socket.on('send_chat_message', (data) => {
        const { roomId, text, senderName } = data;
        io.to(roomId).emit('receive_chat_message', {
            senderId: socket.id,
            senderName: senderName,
            text: text
        });
    });

    // --- OYUNDAN ÇIKIŞ ---
    socket.on('leave_game', (data) => {
        const { roomId } = data;
        if (rooms[roomId]) {
            const room = rooms[roomId];
            console.log(`Oyuncu ${socket.id} oyundan ayrıldı.`);
            const remainingPlayerId = room.players.find(pid => pid !== socket.id);
            
            if (remainingPlayerId) {
                const remainingIndex = room.players.indexOf(remainingPlayerId);
                const winnerColor = COLORS[remainingIndex];
                io.to(roomId).emit('game_over_by_disconnect', { winner: winnerColor });
            }
        }
    });

    // --- ZAR ATMA (Şans Faktörü Dahil) ---
    socket.on('roll_dice', (data) => {
        const { roomId } = data;
        if (rooms[roomId]) {
            const room = rooms[roomId];
            const playerId = socket.id;

            if (!room.badLuckCounters) room.badLuckCounters = {};
            if (room.badLuckCounters[playerId] === undefined) room.badLuckCounters[playerId] = 0;

            let diceValue;
            // 5 kere 6 atamazsa yardım et
            if (room.badLuckCounters[playerId] >= 5) {
                diceValue = 6;
                room.badLuckCounters[playerId] = 0; 
                console.log(`Oyuncu ${playerId} şans yardımı: 6`);
            } else {
                diceValue = Math.floor(Math.random() * 6) + 1;
                if (diceValue === 6) room.badLuckCounters[playerId] = 0;
                else room.badLuckCounters[playerId]++;
            }
            io.to(roomId).emit('dice_rolled', { value: diceValue });
        }
    });

    socket.on('move_pawn', (data) => {
        io.to(data.roomId).emit('pawn_moved', { pawnId: data.pawnId });
    });

    socket.on('pass_turn', (data) => {
        const { roomId } = data;
        if (rooms[roomId]) {
            const room = rooms[roomId];
            const currentPlayerId = room.players[room.currentTurnIndex];
            
            // Sıra kimdeyse o değiştirebilir
            if (socket.id !== currentPlayerId) return; 

            room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length; 
            const nextColor = COLORS[room.currentTurnIndex];
            io.to(roomId).emit('turn_changed', { currentTurn: nextColor });
        }
    });

    socket.on('disconnect', () => {
        console.log("Bir oyuncu sunucudan koptu:", socket.id);
    });
});

// 🔥 Render Port Ayarı
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor...`);
});