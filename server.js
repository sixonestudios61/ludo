const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// 🔥 Render Health Check
app.get('/', (req, res) => {
    res.send("🚀 Ludo Sunucusu (Lobi Destekli) Aktif!");
});

// 🔥 Socket.io Ayarları
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

// 🔥 YARDIMCI FONKSİYON: İstemcilere gidecek temiz oda listesi
function getRoomList() {
    let roomList = [];
    for (const [id, room] of Object.entries(rooms)) {
        // Sadece oyunu başlamamış ve boş yeri olan odaları listele
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

io.on('connection', (socket) => {
    console.log('Yeni Oyuncu Bağlandı:', socket.id);

    // 1️⃣ BAĞLANIR BAĞLANMAZ LİSTEYİ GÖNDER
    // Yeni gelen oyuncu, o anki açık odaları hemen görür.
    socket.emit('room_list_update', getRoomList());

    // İstemci manuel olarak liste isterse (Yenile butonu vs.)
    socket.on('get_room_list', () => {
        socket.emit('room_list_update', getRoomList());
    });

    // --- ODA OLUŞTURMA ---
    socket.on('create_room', (data) => {
        const roomId = Math.floor(100000 + Math.random() * 900000).toString();
        const capacity = data && data.maxPlayers ? data.maxPlayers : 4;

        rooms[roomId] = {
            players: [socket.id],
            maxPlayers: capacity, 
            currentTurnIndex: 0,
            badLuckCounters: {},
            isGameStarted: false // Oyun başladı mı kontrolü
        };

        socket.join(roomId);
        console.log(`Oda Kuruldu: ${roomId}`);
        socket.emit('room_created', { roomId: roomId });
        
        // 🔥 HERKESE GÜNCEL LİSTEYİ DUYUR (Yeni oda açıldı!)
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
            }
            
            socket.join(roomId);
            console.log(`Oyuncu ${socket.id}, ${roomId} odasına katıldı.`);
            socket.emit('room_joined', { roomId: roomId });
            io.to(roomId).emit('player_joined_room', { count: room.players.length });
            
            // 🔥 LİSTEYİ GÜNCELLE (Oda doluluk oranı değişti)
            io.emit('room_list_update', getRoomList());

        } else {
            socket.emit('error', { message: 'Böyle bir oda bulunamadı!' });
        }
    });

    // --- OYUNU BAŞLAT ---
    socket.on('start_game_command', (data) => {
        const { roomId } = data;
        if(rooms[roomId]) {
            const room = rooms[roomId];
            room.isGameStarted = true; // Artık bu oda lobide görünmesin

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
            // 🔥 OYUN BAŞLADIĞI İÇİN LİSTEDEN KALDIR
            io.emit('room_list_update', getRoomList());
        }
    });

    // --- SOHBET ---
    socket.on('send_chat_message', (data) => {
        io.to(data.roomId).emit('receive_chat_message', {
            senderId: socket.id,
            senderName: data.senderName,
            text: data.text
        });
    });

    // --- ZAR ATMA ---
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

    // --- KOPMA (DISCONNECT) ---
    socket.on('disconnect', () => {
        console.log("Kopan Oyuncu:", socket.id);
        
        // Oyuncunun olduğu odaları bul ve temizle
        let listChanged = false;
        for (const [id, room] of Object.entries(rooms)) {
            if (room.players.includes(socket.id)) {
                room.players = room.players.filter(pid => pid !== socket.id);
                listChanged = true;
                
                // Eğer odada kimse kalmadıysa odayı sil
                if (room.players.length === 0) {
                    delete rooms[id];
                    console.log(`Oda ${id} boşaldığı için silindi.`);
                } else {
                    // Odada biri kaldıysa ona haber ver
                    io.to(id).emit('player_joined_room', { count: room.players.length });
                    
                    // Oyun başladıysa ve biri koptuysa oyunu bitir
                    if (room.isGameStarted) {
                         const remainingIndex = 0; 
                         const winnerColor = COLORS[remainingIndex];
                         io.to(id).emit('game_over_by_disconnect', { winner: winnerColor });
                         delete rooms[id]; 
                    }
                }
            }
        }
        // 🔥 BİRİ ÇIKINCA LİSTEYİ GÜNCELLE
        if (listChanged) {
            io.emit('room_list_update', getRoomList());
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor...`);
});
