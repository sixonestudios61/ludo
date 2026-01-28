const express = require('express');
const http = require('http');
const {
  Server
} = require('socket.io');

const app = express();
const server = http.createServer(app);

app.get('/', (req, res) => {
  res.send("🚀 Ludo Sunucusu (Full Profil & Arkadaşlık) Aktif!");
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
// 🔥 YENİ: Oyuncu detaylarını socket ID'ye göre saklıyoruz
let playerDetails = {};
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

  // 🔥 GÜNCELLEME: İsim, Avatar ve DB ID'yi de gönderiyoruz
  const playerList = room.players.map((pid, index) => ({
    socketId: pid,
    color: COLORS[index], // Oyuncunun rengini de bildiriyoruz
    isReady: room.readyStates[pid] || false,
    name: playerDetails[pid]?.name || "Oyuncu",
    avatar: playerDetails[pid]?.avatar || "assets/avatars/avatar_1.png",
    dbId: playerDetails[pid]?.dbId || "" // Arkadaş eklemek için gerekli ID
  }));

  io.to(roomId).emit('player_update', {
    players: playerList
  });
}

io.on('connection', (socket) => {
  console.log('Yeni Oyuncu:', socket.id);
  socket.emit('room_list_update', getRoomList());

  socket.on('get_room_list', () => {
    socket.emit('room_list_update', getRoomList());
  });

  // --- ODA OLUŞTURMA ---
  socket.on('create_room', (data) => {
    // 🔥 Verileri kaydet
    playerDetails[socket.id] = {
      name: data.name,
      avatar: data.avatar,
      dbId: data.dbId
    };

    const roomId = Math.floor(100000 + Math.random() * 900000).toString();
    const capacity = data && data.maxPlayers ? data.maxPlayers : 4;

    rooms[roomId] = {
      players: [socket.id],
      readyStates: {
        [socket.id]: false
      },
      maxPlayers: capacity,
      currentTurnIndex: 0,
      badLuckCounters: {},
      isGameStarted: false
    };

    socket.join(roomId);
    socket.emit('room_created', {
      roomId: roomId
    });
    broadcastPlayerUpdate(roomId);
    io.emit('room_list_update', getRoomList());
  });

  // --- ODAYA KATILMA ---
  socket.on('join_game', (data) => {
    // 🔥 Verileri kaydet
    playerDetails[socket.id] = {
      name: data.name,
      avatar: data.avatar,
      dbId: data.dbId
    };

    const {
      roomId
    } = data;
    if (rooms[roomId]) {
      const room = rooms[roomId];

      if (room.players.length >= room.maxPlayers && !room.players.includes(socket.id)) {
        socket.emit('error', {
          message: 'Oda dolu!'
        });
        return;
      }

      if (!room.players.includes(socket.id)) {
        room.players.push(socket.id);
        room.readyStates[socket.id] = false;
      }

      socket.join(roomId);
      socket.emit('room_joined', {
        roomId: roomId
      });

      broadcastPlayerUpdate(roomId);
      io.emit('room_list_update', getRoomList());

    } else {
      socket.emit('error', {
        message: 'Böyle bir oda bulunamadı!'
      });
    }
  });

  socket.on('toggle_ready', (data) => {
    const {
      roomId
    } = data;
    if (rooms[roomId]) {
      const room = rooms[roomId];
      room.readyStates[socket.id] = !room.readyStates[socket.id];
      broadcastPlayerUpdate(roomId);
    }
  });

  // --- OYUNU BAŞLAT ---
  socket.on('start_game_command', (data) => {
    const {
      roomId
    } = data;
    if (rooms[roomId]) {
      const room = rooms[roomId];
      room.isGameStarted = true;

      // Şans sayaçlarını sıfırla
      room.players.forEach(pid => {
        if (!room.badLuckCounters) room.badLuckCounters = {};
        room.badLuckCounters[pid] = 0;
      });

      const clients = io.sockets.adapter.rooms.get(roomId);
      if (clients) {
        let index = 0;
        for (const clientId of clients) {
          const clientSocket = io.sockets.sockets.get(clientId);
          if (clientSocket) {
            const myColor = COLORS[index];
            // 🔥 Rakiplerin detaylı listesini gönder
            clientSocket.emit('game_launch', {
              yourColor: myColor,
              roomId: roomId,
              playerCount: room.maxPlayers,
              // Odadaki tüm oyuncuların detaylarını gönderiyoruz ki UI'da gösterilsin
              playersData: room.players.map((pid, idx) => ({
                color: COLORS[idx],
                name: playerDetails[pid]?.name || "Oyuncu",
                avatar: playerDetails[pid]?.avatar || "assets/avatars/avatar_1.png",
                dbId: playerDetails[pid]?.dbId || ""
              }))
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
    const {
      roomId
    } = data;
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
      io.to(roomId).emit('dice_rolled', {
        value: diceValue
      });
    }
  });

  socket.on('move_pawn', (data) => io.to(data.roomId).emit('pawn_moved', data));

  socket.on('pass_turn', (data) => {
    if (rooms[data.roomId]) {
      const room = rooms[data.roomId];
      room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
      io.to(data.roomId).emit('turn_changed', {
        currentTurn: COLORS[room.currentTurnIndex]
      });
    }
  });

  // --- KOPMA VE ÇIKMA İŞLEMLERİ ---
  const handleDisconnect = (socketId) => {
    console.log("Kopan Oyuncu:", socketId);
    let listChanged = false;

    // Oyuncunun detaylarını temizle
    if (playerDetails[socketId]) {
      delete playerDetails[socketId];
    }

    for (const [id, room] of Object.entries(rooms)) {
      if (room.players.includes(socketId)) {
        room.players = room.players.filter(pid => pid !== socketId);
        if (room.readyStates) delete room.readyStates[socketId];
        listChanged = true;

        if (room.players.length === 0) {
          delete rooms[id];
        } else {
          broadcastPlayerUpdate(id);

          // 🔥 Oyun başladıysa ve biri çıktıysa diğerine kazandığını bildir
          if (room.isGameStarted) {
            const remainingIndex = 0; // Kalan ilk kişi (basit mantık)
            // Kalan kişinin rengini bulmamız lazım, ama basitçe ilk rengi atayalım
            // Daha gelişmişi: Kalan kişinin ID'sine göre rengini bulmak.
            // Şimdilik kalan kişiye "Sen Kazandın" sinyali gönderelim.
            // Kalan kişiye özel mesaj atıyoruz:
            const winnerId = room.players[0];
            io.to(id).emit('game_over_by_disconnect', {
              winnerId: winnerId
            }); // ID gönderiyoruz
            delete rooms[id];
          }
        }
      }
    }
    if (listChanged) io.emit('room_list_update', getRoomList());
  };

  socket.on('leave_game', (data) => {
    handleDisconnect(socket.id);
  });

  socket.on('disconnect', () => {
    handleDisconnect(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor...`);
});
