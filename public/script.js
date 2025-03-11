const socket = io();
let currentPlayer = null;

// Добавляем переменные для админки
let isAdmin = false;
let currentAdminTable = null;

// Добавляем функцию сохранения данных игрока
function savePlayerData(player) {
    localStorage.setItem('playerData', JSON.stringify({
        id: player.id,
        name: player.name,
        role: player.role,
        tableId: player.tableId
    }));
}

// Добавляем функцию загрузки данных игрока
function loadPlayerData() {
    const savedData = localStorage.getItem('playerData');
    return savedData ? JSON.parse(savedData) : null;
}

// Функция для переподключения игрока
function reconnectPlayer() {
    const savedPlayer = loadPlayerData();
    if (savedPlayer) {
        socket.emit('reconnectPlayer', savedPlayer);
    }
}

// Обработка переподключения при загрузке страницы
window.addEventListener('load', () => {
    reconnectPlayer();
});

// Функция входа в игру
function login() {
    const name = document.getElementById('nameInput').value;
    const referral = document.getElementById('referralInput').value;
    
    if (!name) {
        showLoginMessage('Пожалуйста, введите ваше имя', 'danger');
        return;
    }

    socket.emit('login', { name, referral });
}

// Обработка ответа на вход
socket.on('loginResponse', (response) => {
    if (response.success) {
        currentPlayer = response.player;
        savePlayerData(response.player); // Сохраняем данные игрока
        document.getElementById('loginForm').style.display = 'none';
        document.getElementById('adminLoginForm').style.display = 'none';
        document.getElementById('gameTable').style.display = 'block';
        
        // Показываем соответствующие кнопки действий
        if (currentPlayer.role === 'Дух') {
            document.getElementById('giftButton').style.display = 'inline-block';
        } else if (currentPlayer.role === 'Сын') {
            document.getElementById('referralButton').style.display = 'inline-block';
        }
        
        updateTable(response.table);
    } else {
        showLoginMessage(response.message, 'danger');
    }
});

// Обновление отображения стола
function updateTable(table) {
    const players = table.players;
    
    // Очищаем все позиции
    clearAllPositions();
    
    // Заполняем позиции игроками
    players.forEach(player => {
        const element = getPlayerElement(player.role);
        if (element) {
            element.innerHTML = `
                <h4>${player.role}</h4>
                <div class="player-name">${player.name}</div>
                ${player.role === 'Дух' ? `
                    ${player.giftSent ? '<div class="badge bg-warning">Подарок отправлен</div>' : ''}
                    ${player.giftConfirmed ? '<div class="badge bg-success">Подарок подтвержден</div>' : ''}
                ` : ''}
                ${currentPlayer && currentPlayer.role === 'Дед' && player.role === 'Дух' && player.giftSent && !player.giftConfirmed ? `
                    <button class="btn btn-success btn-sm mt-2" onclick="confirmGift('${player.id}')">
                        Подтвердить подарок
                    </button>
                ` : ''}
            `;
            
            // Добавляем классы для текущего игрока и статуса подарка
            if (currentPlayer && player.id === currentPlayer.id) {
                element.classList.add('active');
            }
            if (player.role === 'Дух') {
                if (player.giftConfirmed) {
                    element.classList.add('gift-confirmed');
                } else if (player.giftSent) {
                    element.classList.add('gift-sent');
                }
            }
        }
    });
}

// Получение элемента для определенной роли
function getPlayerElement(role) {
    switch (role) {
        case 'Дед':
            return document.getElementById('grandfather');
        case 'Отец':
            return document.getElementById('father');
        case 'Сын':
            const emptySlot = Array.from([
                document.getElementById('son1'),
                document.getElementById('son2')
            ]).find(el => !el.querySelector('.player-name'));
            return emptySlot;
        case 'Дух':
            const spiritSlot = Array.from([
                document.getElementById('spirit1'),
                document.getElementById('spirit2'),
                document.getElementById('spirit3'),
                document.getElementById('spirit4')
            ]).find(el => !el.querySelector('.player-name'));
            return spiritSlot;
        default:
            return null;
    }
}

// Очистка всех позиций на столе
function clearAllPositions() {
    ['grandfather', 'father', 'son1', 'son2', 'spirit1', 'spirit2', 'spirit3', 'spirit4'].forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.innerHTML = `
                <h4>${element.id.replace(/\d+$/, '').charAt(0).toUpperCase() + element.id.replace(/\d+$/, '').slice(1)}</h4>
                <div class="player-placeholder">Ожидание...</div>
            `;
            element.classList.remove('active', 'gift-sent');
        }
    });
}

// Отправка подарка
function sendGift() {
    if (currentPlayer && currentPlayer.role === 'Дух' && !currentPlayer.giftSent) {
        socket.emit('sendGift');
        document.getElementById('giftButton').disabled = true;
    }
}

// Генерация реферальной ссылки
function generateReferral() {
    if (currentPlayer && currentPlayer.role === 'Сын') {
        socket.emit('generateReferral');
    }
}

// Обработка получения реферальной ссылки
socket.on('referralGenerated', (data) => {
    const referralElement = document.getElementById('referralLink');
    const existingLinks = referralElement.querySelectorAll('.referral-item').length;
    
    // Проверяем, что игрок все еще Сын
    if (currentPlayer && currentPlayer.role === 'Сын') {
        const newLinkHtml = `
            <div class="referral-item mb-2">
                <strong>Реферальная ссылка ${existingLinks + 1}:</strong> 
                <span class="referral-code">${data.link}</span>
                <button class="btn btn-sm btn-outline-primary ms-2" onclick="copyReferral('${data.link}')">
                    Копировать
                </button>
            </div>
        `;

        if (existingLinks === 0) {
            referralElement.innerHTML = newLinkHtml;
        } else {
            referralElement.insertAdjacentHTML('beforeend', newLinkHtml);
        }
        
        referralElement.style.display = 'block';
    }
});

// Обработка ошибки генерации реферальной ссылки
socket.on('referralError', (data) => {
    showGameMessage(data.message, 'warning');
});

// Функция для копирования реферальной ссылки
function copyReferral(referral) {
    navigator.clipboard.writeText(referral).then(() => {
        showGameMessage('Реферальная ссылка скопирована в буфер обмена', 'success');
    });
}

// Обработка обновления стола
socket.on('tableUpdate', (table) => {
    updateTable(table);
});

// Обработка разделения стола
socket.on('tableSplit', (data) => {
    showGameMessage(data.message, 'info');
    
    // Обновляем текущего игрока и сбрасываем статусы подарков
    const player = data.table.players.find(p => p.id === socket.id);
    if (player) {
        // Если игрок был Духом и стал Сыном, сбрасываем статусы подарков
        if (currentPlayer && currentPlayer.role === 'Дух' && player.role === 'Сын') {
            player.giftSent = false;
            player.giftConfirmed = false;
        }
        currentPlayer = player;
    }
    
    updateTable(data.table);
    
    // Очищаем чат при переходе на новый стол
    document.getElementById('chatMessages').innerHTML = '';
    
    // Сбрасываем все кнопки и ссылки
    document.getElementById('giftButton').style.display = 'none';
    document.getElementById('referralButton').style.display = 'none';
    document.getElementById('referralLink').innerHTML = '';
    document.getElementById('referralLink').style.display = 'none';
    
    // Если игрок стал Сыном и может генерировать ссылки
    if (player && player.role === 'Сын' && data.canGenerateReferrals) {
        document.getElementById('referralButton').style.display = 'inline-block';
    }
});

// Функция отправки сообщения в чат
function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    
    if (message && currentPlayer) {
        socket.emit('chatMessage', message);
        input.value = '';
    }
}

// Обработка входящих сообщений чата
socket.on('chatMessage', (data) => {
    // Добавляем сообщение в обычный чат
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${data.isSystem ? 'system-message' : ''} ${data.isAdmin ? 'admin-message' : ''}`;
        
        if (data.isSystem) {
            messageDiv.innerHTML = `
                <span class="message">${data.message}</span>
                <span class="timestamp">${data.timestamp}</span>
            `;
        } else {
            messageDiv.innerHTML = `
                <span class="sender">${data.sender}</span>
                ${data.role ? `<span class="role">(${data.role})</span>` : ''}
                ${data.isAdmin ? '<span class="admin-badge">Админ</span>' : ''}
                <span class="timestamp">${data.timestamp}</span>
                <div class="message">${data.message}</div>
            `;
        }
        
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    
    // Добавляем сообщение в админский чат, если админ просматривает этот стол
    appendMessageToAdminChat(data);
});

// Обработка нажатия Enter в поле ввода чата
document.getElementById('chatInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendChatMessage();
    }
});

// Вспомогательные функции для отображения сообщений
function showLoginMessage(message, type) {
    const element = document.getElementById('loginMessage');
    element.textContent = message;
    element.className = `alert alert-${type} mt-3`;
    element.style.display = 'block';
}

function showGameMessage(message, type) {
    const element = document.getElementById('gameMessage');
    element.textContent = message;
    element.className = `alert alert-${type} mt-3`;
    element.style.display = 'block';
    
    // Автоматически скрываем сообщение через 5 секунд
    setTimeout(() => {
        element.style.display = 'none';
    }, 5000);
}

// Функция входа для админа
function adminLogin() {
    const login = document.getElementById('adminLogin').value;
    const password = document.getElementById('adminPassword').value;
    
    socket.emit('adminLogin', { login, password });
}

// Добавляем функцию обновления админских логов
function updateAdminLogs(log) {
    const logsContainer = document.getElementById('adminLogs');
    if (!logsContainer) return;

    const logElement = document.createElement('div');
    logElement.className = `log-entry ${log.type}`;
    logElement.innerHTML = `
        <span class="timestamp">[${log.timestamp}]</span>
        <span class="message">${log.message}</span>
    `;
    logsContainer.appendChild(logElement);
    logsContainer.scrollTop = logsContainer.scrollHeight;
}

// Обновляем обработчик adminLoginResponse
socket.on('adminLoginResponse', (response) => {
    if (response.success) {
        isAdmin = true;
        document.getElementById('loginForm').style.display = 'none';
        document.getElementById('adminLoginForm').style.display = 'none';
        document.getElementById('adminPanel').style.display = 'block';
        
        // Отображаем историю логов
        const logsContainer = document.getElementById('adminLogs');
        if (logsContainer && response.logs) {
            logsContainer.innerHTML = '';
            response.logs.forEach(log => updateAdminLogs(log));
        }
        
        updateAdminStats(response.stats);
    } else {
        showLoginMessage(response.message, 'danger');
    }
});

// Добавляем обработчик новых логов
socket.on('adminLog', (log) => {
    if (isAdmin) {
        updateAdminLogs(log);
    }
});

// Обновляем обработчик adminReferralGenerated
socket.on('adminReferralGenerated', (data) => {
    if (!isAdmin) return;
    
    const referralMessage = `
        <div class="alert alert-success">
            <strong>Новая реферальная ссылка для ${data.sonName}:</strong><br>
            Ссылка: ${data.referral}<br>
            Осталось использований: ${data.remainingUses}
            <button class="btn btn-sm btn-outline-primary ms-2" onclick="copyReferral('${data.referral}')">
                Копировать
            </button>
        </div>
    `;
    
    const messagesContainer = document.getElementById('adminMessages');
    if (messagesContainer) {
        messagesContainer.insertAdjacentHTML('beforeend', referralMessage);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
});

// Обновление статистики
socket.on('adminStatsUpdate', (stats) => {
    if (isAdmin) {
        updateAdminStats(stats);
    }
});

// Обновление списка столов
socket.on('adminTablesUpdate', (tables) => {
    console.log('Получено обновление столов:', tables);
    if (isAdmin) {
        updateAdminTables(tables);
        if (currentAdminTable) {
            const currentTable = tables.find(t => t.id === currentAdminTable);
            if (currentTable) {
                console.log('Обновляем вид текущего стола:', currentTable);
                updateAdminTableView(currentTable);
            }
        }
    }
});

// Обновляем обработчик присоединения к столу для админа
socket.on('adminTableJoined', (data) => {
    console.log('Получены данные о присоединении к столу:', data);
    if (isAdmin) {
        currentAdminTable = data.table.id;
        
        // Обновляем отображение стола
        updateAdminTableView(data.table);
        
        // Очищаем чат
        const adminChatMessages = document.getElementById('adminChatMessages');
        if (adminChatMessages) {
            adminChatMessages.innerHTML = '';
            
            // Добавляем историю чата
            if (data.chatHistory) {
                data.chatHistory.forEach(msg => {
                    appendMessageToAdminChat(msg);
                });
            }
        }
    }
});

// Функция обновления статистики
function updateAdminStats(stats) {
    document.getElementById('adminStats').innerHTML = `
        <div class="card mb-3">
            <div class="card-body">
                <h5 class="card-title">Статистика игры</h5>
                <p>Активные столы: ${stats.activeTables}</p>
                <p>Закрытые столы: ${stats.closedTables}</p>
                <p>Всего игроков: ${stats.totalPlayers}</p>
                <p>Активных игроков: ${stats.activePlayers}</p>
            </div>
        </div>
    `;
}

// Функция обновления списка столов
function updateAdminTables(tables) {
    const tablesList = document.getElementById('adminTables');
    tablesList.innerHTML = tables.map(table => `
        <div class="card mb-3 ${table.hasAdminGrandfather ? 'border-primary' : ''}">
            <div class="card-body">
                <h5 class="card-title">Стол ${table.id}</h5>
                <p>Игроков: ${table.playersCount}</p>
                <p>Статус: ${table.status}</p>
                ${table.hasAdminGrandfather ? '<p class="text-primary">Вы являетесь Дедом на этом столе</p>' : ''}
                <button class="btn btn-primary" onclick="adminJoinTable('${table.id}')">
                    Присоединиться к столу
                </button>
            </div>
        </div>
    `).join('');
}

// Функция обновления админского вида стола
function updateAdminTableView(table) {
    const view = document.getElementById('adminTableView');
    if (!view) return;

    // Проверяем, является ли админ дедом в этом столе
    const isAdminGrandfather = table.players.some(p => p.role === 'Дед' && p.isAdmin);

    // Создаем структуру стола
    let html = `
        <div class="table-info mb-4">
            <h3>Игроки за столом</h3>
            <div class="row">
                <!-- Дед -->
                <div class="col-12 text-center mb-3">
                    <div id="admin-grandfather" class="player-card">
                        <h4>Дед</h4>
                        <div class="player-placeholder">Ожидание...</div>
                    </div>
                </div>
                
                <!-- Отец -->
                <div class="col-12 text-center mb-3">
                    <div id="admin-father" class="player-card">
                        <h4>Отец</h4>
                        <div class="player-placeholder">Ожидание...</div>
                    </div>
                </div>
                
                <!-- Сыновья -->
                <div class="col-12 text-center mb-3">
                    <div class="row justify-content-center">
                        <div class="col-md-6">
                            <div id="admin-son1" class="player-card">
                                <h4>Сын 1</h4>
                                <div class="player-placeholder">Ожидание...</div>
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div id="admin-son2" class="player-card">
                                <h4>Сын 2</h4>
                                <div class="player-placeholder">Ожидание...</div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Духи -->
                <div class="col-12 text-center">
                    <div class="row justify-content-center">
                        <div class="col-md-3">
                            <div id="admin-spirit1" class="player-card">
                                <h4>Дух 1</h4>
                                <div class="player-placeholder">Ожидание...</div>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <div id="admin-spirit2" class="player-card">
                                <h4>Дух 2</h4>
                                <div class="player-placeholder">Ожидание...</div>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <div id="admin-spirit3" class="player-card">
                                <h4>Дух 3</h4>
                                <div class="player-placeholder">Ожидание...</div>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <div id="admin-spirit4" class="player-card">
                                <h4>Дух 4</h4>
                                <div class="player-placeholder">Ожидание...</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div class="admin-chat">
            <div id="adminChatMessages"></div>
            <div id="adminMessageControls" class="mb-3">
                <div class="btn-group">
                    <button class="btn btn-primary" onclick="adminSendMessage(false)">
                        Отправить как Админ
                    </button>
                    ${isAdminGrandfather ? `
                        <button class="btn btn-success" onclick="adminSendMessage(true)">
                            Отправить как Дед
                        </button>
                    ` : ''}
                </div>
            </div>
            <textarea id="adminChatInput" class="form-control" rows="2" placeholder="Введите сообщение..."></textarea>
        </div>
    `;

    view.innerHTML = html;

    // Заполняем карточки игроков
    table.players.forEach(player => {
        let cardId;
        if (player.role === 'Дед') {
            cardId = 'admin-grandfather';
        } else if (player.role === 'Отец') {
            cardId = 'admin-father';
        } else if (player.role === 'Сын') {
            // Находим первую свободную карточку сына
            for (let i = 1; i <= 2; i++) {
                const card = document.getElementById(`admin-son${i}`);
                if (card.querySelector('.player-placeholder')) {
                    cardId = `admin-son${i}`;
                    break;
                }
            }
        } else if (player.role === 'Дух') {
            // Находим первую свободную карточку духа
            for (let i = 1; i <= 4; i++) {
                const card = document.getElementById(`admin-spirit${i}`);
                if (card.querySelector('.player-placeholder')) {
                    cardId = `admin-spirit${i}`;
                    break;
                }
            }
        }

        if (cardId) {
            const card = document.getElementById(cardId);
            if (card) {
                card.innerHTML = `
                    <h4>${player.role}</h4>
                    <div class="player-name">${player.name}</div>
                    ${player.role === 'Дух' ? `
                        ${player.giftSent ? '<div class="badge bg-warning">Подарок отправлен</div>' : ''}
                        ${player.giftConfirmed ? '<div class="badge bg-success">Подарок подтвержден</div>' : ''}
                    ` : ''}
                    <div class="player-actions">
                        ${player.role === 'Сын' ? `
                            <button class="btn btn-sm btn-info" onclick="socket.emit('adminGenerateReferral', { tableId: '${table.id}', sonId: '${player.id}' })">
                                Реф. ссылка
                            </button>
                        ` : ''}
                        ${player.role === 'Дух' && player.giftSent && !player.giftConfirmed && isAdminGrandfather ? `
                            <button class="btn btn-sm btn-success" onclick="socket.emit('confirmGift', { spiritId: '${player.id}' })">
                                Подтвердить подарок
                            </button>
                        ` : ''}
                        ${!player.isAdmin ? `
                            <button class="btn btn-sm btn-danger" onclick="socket.emit('adminRemovePlayer', { tableId: '${table.id}', playerId: '${player.id}' })">
                                Удалить
                            </button>
                        ` : ''}
                    </div>
                `;
            }
        }
    });
}

// Функции управления столом для админа
function adminJoinTable(tableId) {
    socket.emit('adminJoinTable', tableId);
}

function adminRemovePlayer(playerId) {
    if (currentAdminTable) {
        socket.emit('adminRemovePlayer', {
            tableId: currentAdminTable,
            playerId
        });
    }
}

function adminGenerateReferral(sonId) {
    if (currentAdminTable) {
        socket.emit('adminGenerateReferral', {
            tableId: currentAdminTable,
            sonId
        });
    }
}

function adminSendMessage(asPlayer) {
    const message = document.getElementById('adminChatInput').value.trim();
    if (message && currentAdminTable) {
        socket.emit('adminChatMessage', {
            tableId: currentAdminTable,
            message,
            asPlayer
        });
        document.getElementById('adminChatInput').value = '';
    }
}

// Добавляем функцию добавления сообщения в админский чат
function appendMessageToAdminChat(data) {
    const adminChatMessages = document.getElementById('adminChatMessages');
    if (adminChatMessages && isAdmin) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${data.isSystem ? 'system-message' : ''} ${data.isAdmin ? 'admin-message' : ''}`;
        
        if (data.isSystem) {
            messageDiv.innerHTML = `
                <span class="message">${data.message}</span>
                <span class="timestamp">${data.timestamp}</span>
            `;
        } else {
            messageDiv.innerHTML = `
                <span class="sender">${data.sender}</span>
                ${data.role ? `<span class="role">(${data.role})</span>` : ''}
                ${data.isAdmin ? '<span class="admin-badge">Админ</span>' : ''}
                <span class="timestamp">${data.timestamp}</span>
                <div class="message">${data.message}</div>
            `;
        }
        
        adminChatMessages.appendChild(messageDiv);
        adminChatMessages.scrollTop = adminChatMessages.scrollHeight;
    }
}

// Добавляем функцию подтверждения подарка
function confirmGift(spiritId) {
    socket.emit('confirmGift', { spiritId });
}

// Обработка подтверждения подарка
socket.on('giftConfirmed', (data) => {
    if (data.success) {
        showGameMessage('Подарок подтвержден!', 'success');
    } else {
        showGameMessage(data.message || 'Ошибка при подтверждении подарка', 'danger');
    }
});

// Добавляем обработчик успешного переподключения
socket.on('reconnectResponse', (response) => {
    if (response.success) {
        currentPlayer = response.player;
        document.getElementById('loginForm').style.display = 'none';
        document.getElementById('adminLoginForm').style.display = 'none';
        document.getElementById('gameTable').style.display = 'block';
        
        if (currentPlayer.role === 'Дух') {
            document.getElementById('giftButton').style.display = 'inline-block';
        } else if (currentPlayer.role === 'Сын') {
            document.getElementById('referralButton').style.display = 'inline-block';
        }
        
        updateTable(response.table);
    } else {
        // Если переподключение не удалось, очищаем сохраненные данные
        localStorage.removeItem('playerData');
        document.getElementById('loginForm').style.display = 'block';
        document.getElementById('adminLoginForm').style.display = 'block';
        document.getElementById('gameTable').style.display = 'none';
    }
});

// Обновляем функцию выхода (если она есть)
function logout() {
    localStorage.removeItem('playerData');
    currentPlayer = null;
    socket.emit('logout');
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('adminLoginForm').style.display = 'block';
    document.getElementById('gameTable').style.display = 'none';
}

function toggleLoginForm(type) {
    if (type === 'admin') {
        document.getElementById('loginForm').style.display = 'none';
        document.getElementById('adminLoginForm').style.display = 'block';
    } else {
        document.getElementById('adminLoginForm').style.display = 'none';
        document.getElementById('loginForm').style.display = 'block';
    }
}