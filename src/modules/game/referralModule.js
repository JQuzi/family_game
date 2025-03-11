class ReferralModule {
    constructor() {
        // Формат: { referralCode: { sonId, sonName, used, remainingUses } }
        this.referralLinks = new Map();
    }

    generateUniqueReferral() {
        return 'ref-' + Math.random().toString(36).substring(2, 15);
    }

    createReferral(sonId, sonName, tableId, isAdminGenerated = false) {
        const referral = this.generateUniqueReferral();
        this.referralLinks.set(referral, {
            sonId,
            sonName,
            remainingUses: isAdminGenerated ? 3 : 1,
            isAdminGenerated,
            tableId
        });
        return referral;
    }

    getReferralInfo(referral) {
        return this.referralLinks.get(referral);
    }

    useReferral(referral) {
        const referralInfo = this.referralLinks.get(referral);
        if (referralInfo && referralInfo.remainingUses > 0) {
            referralInfo.remainingUses--;
            return true;
        }
        return false;
    }

    clearTableReferrals(playerIds) {
        for (const [code, info] of this.referralLinks.entries()) {
            if (playerIds.includes(info.sonId)) {
                this.referralLinks.delete(code);
            }
        }
    }

    findTableIdByReferral(referral) {
        if (!referral) return null;
        
        const referralInfo = this.referralLinks.get(referral);
        if (!referralInfo) return null;
        
        return referralInfo.tableId;
    }
}

module.exports = ReferralModule; 