class ProfileController {

    _registry;

    constructor(registry) {
        this._registry = registry;
    }

    async getProfiles() {
        var profiles;
        var str = await this._registry.get('profiles');
        if (str)
            profiles = JSON.parse(str);
        return profiles;
    }

    async setProfiles(profiles) {
        return this._registry.upsert('profiles', JSON.stringify(profiles));
    }
}

module.exports = ProfileController;