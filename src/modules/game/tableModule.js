class TableModule {
    constructor() {
        this.tables = {};
        this.gameStats = {
            closedTables: 0,
            totalRegisteredPlayers: new Set(),
            activeGames: new Map()
        };
    }

    createNewTable(id) {
        const table = {
            id,
            players: [],
            status: 'waiting',
            maxPlayers: 8
        };
        this.tables[id] = table;
        return table;
    }

    getTable(tableId) {
        return this.tables[tableId];
    }

    getAllTables() {
        return this.tables;
    }

    removeTable(tableId) {
        delete this.tables[tableId];
    }

    addPlayer(tableId, player) {
        const table = this.tables[tableId];
        if (table) {
            table.players.push(player);
            this.gameStats.totalRegisteredPlayers.add(player.id);
            return true;
        }
        return false;
    }

    removePlayer(tableId, playerId) {
        const table = this.tables[tableId];
        if (table) {
            const playerIndex = table.players.findIndex(p => p.id === playerId);
            if (playerIndex !== -1) {
                return table.players.splice(playerIndex, 1)[0];
            }
        }
        return null;
    }

    findPlayerBySocketId(socketId) {
        for (const tableId in this.tables) {
            const player = this.tables[tableId].players.find(p => p.id === socketId);
            if (player) return player;
        }
        return null;
    }

    findTableByPlayerId(socketId) {
        return Object.values(this.tables).find(table => 
            table.players.some(player => player.id === socketId)
        );
    }

    getGameStats() {
        return {
            activeTables: Object.keys(this.tables).length,
            closedTables: this.gameStats.closedTables,
            totalPlayers: this.gameStats.totalRegisteredPlayers.size,
            activePlayers: Object.values(this.tables).reduce((sum, table) => sum + table.players.length, 0)
        };
    }

    getTablesInfo() {
        return Object.entries(this.tables).map(([id, table]) => ({
            id,
            playersCount: table.players.length,
            status: table.status,
            hasAdminGrandfather: table.players.some(p => p.role === 'Дед' && p.isAdmin),
            players: table.players.map(p => ({
                id: p.id,
                name: p.name,
                role: p.role,
                isAdmin: p.isAdmin,
                giftSent: p.giftSent,
                giftConfirmed: p.giftConfirmed
            }))
        }));
    }

    incrementClosedTables() {
        this.gameStats.closedTables++;
    }
}

module.exports = TableModule; 