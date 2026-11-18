"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Pulse8AppleTvAccessory = void 0;
exports.sanitizeHomeKitName = sanitizeHomeKitName;
function sanitizeHomeKitName(rawName, fallback = 'Apple TV') {
    const cleaned = rawName
        .replace(/\+/g, ' and ')
        .replace(/[()[\]{}/\\]/g, ' ')
        .replace(/[^a-zA-Z0-9 '-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[^a-zA-Z0-9]+/, '')
        .replace(/[^a-zA-Z0-9]+$/, '');
    return cleaned.length > 0 ? cleaned.slice(0, 64) : fallback;
}
/**
 * Exposes an Apple TV discovered via Pulse-Eight HDMI-CEC as a single HomeKit accessory
 * containing StatelessProgrammableSwitch buttons (Volume Up, Volume Down, Mute, and optional
 * Power On / Power Off) plus an optional OccupancySensor or Switch tracking CEC power state.
 */
class Pulse8AppleTvAccessory {
    platform;
    accessory;
    device;
    volumeUpService;
    volumeDownService;
    muteService;
    powerOnService = null;
    powerOffService = null;
    occupancyService = null;
    powerSwitchService = null;
    currentPowerState;
    constructor(platform, accessory, device, displayName, pluginVersion, options = {}) {
        this.platform = platform;
        this.accessory = accessory;
        this.device = device;
        const { Service, Characteristic } = this.platform;
        const cleanName = sanitizeHomeKitName(displayName, 'Apple TV');
        const powerSensorType = options.powerSensorType === 'occupancy' || options.powerSensorType === 'switch'
            ? options.powerSensorType
            : 'none';
        const includePowerButtons = options.includePowerButtons === true;
        this.currentPowerState =
            typeof options.initialPowerState === 'boolean' ? options.initialPowerState : null;
        // 1. Accessory Information
        const infoService = this.accessory.getService(Service.AccessoryInformation);
        infoService
            .setCharacteristic(Characteristic.Name, cleanName)
            .setCharacteristic(Characteristic.Manufacturer, 'Apple Inc.')
            .setCharacteristic(Characteristic.Model, 'Apple TV (Pulse-Eight CEC)')
            .setCharacteristic(Characteristic.SerialNumber, `CEC-${device.physicalAddress || device.logicalAddress.toUpperCase()}`)
            .setCharacteristic(Characteristic.FirmwareRevision, pluginVersion);
        // 2. Service Label (required by HomeKit for multi-button StatelessProgrammableSwitch accessories)
        const labelService = this.accessory.getService(Service.ServiceLabel) ||
            this.accessory.addService(Service.ServiceLabel, `${cleanName} Buttons`, 'cec-buttons-label');
        labelService.setCharacteristic(Characteristic.ServiceLabelNamespace, Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS);
        // 3. StatelessProgrammableSwitch buttons (Volume Up, Volume Down, Mute)
        const singleAndLong = [
            Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
            Characteristic.ProgrammableSwitchEvent.LONG_PRESS,
        ];
        const singleOnly = [Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS];
        this.volumeUpService = this.ensureSwitchService('cec-volume-up', sanitizeHomeKitName(`${cleanName} Volume Up`, 'Volume Up'), 1, singleAndLong);
        this.volumeDownService = this.ensureSwitchService('cec-volume-down', sanitizeHomeKitName(`${cleanName} Volume Down`, 'Volume Down'), 2, singleAndLong);
        this.muteService = this.ensureSwitchService('cec-mute', sanitizeHomeKitName(`${cleanName} Mute`, 'Mute'), 3, singleOnly);
        // 4. Optional Power On / Power Off StatelessProgrammableSwitch buttons
        if (includePowerButtons) {
            this.powerOnService = this.ensureSwitchService('cec-power-on', sanitizeHomeKitName(`${cleanName} Power On`, 'Power On'), 4, singleOnly);
            this.powerOffService = this.ensureSwitchService('cec-power-off', sanitizeHomeKitName(`${cleanName} Power Off`, 'Power Off'), 5, singleOnly);
        }
        else {
            this.removeServiceIfPresent(Service.StatelessProgrammableSwitch, 'cec-power-on');
            this.removeServiceIfPresent(Service.StatelessProgrammableSwitch, 'cec-power-off');
        }
        // 5. Optional Power / Activity Sensor (OccupancySensor or Switch)
        if (powerSensorType === 'occupancy') {
            this.removeServiceIfPresent(Service.Switch, 'cec-power-switch');
            this.occupancyService = this.ensureOccupancyService('cec-power-occupancy', sanitizeHomeKitName(`${cleanName} Active`, 'Active'));
        }
        else if (powerSensorType === 'switch') {
            this.removeServiceIfPresent(Service.OccupancySensor, 'cec-power-occupancy');
            this.powerSwitchService = this.ensurePowerSwitchService('cec-power-switch', sanitizeHomeKitName(`${cleanName} Power`, 'Power'), options.onPowerSwitchSet);
        }
        else {
            this.removeServiceIfPresent(Service.OccupancySensor, 'cec-power-occupancy');
            this.removeServiceIfPresent(Service.Switch, 'cec-power-switch');
        }
    }
    removeServiceIfPresent(serviceType, subtype) {
        const existing = this.accessory.getServiceById(serviceType, subtype);
        if (existing) {
            this.accessory.removeService(existing);
        }
    }
    ensureSwitchService(subtype, name, labelIndex, validValues) {
        const { Service, Characteristic } = this.platform;
        let svc = this.accessory.getServiceById(Service.StatelessProgrammableSwitch, subtype);
        if (!svc) {
            svc = new Service.StatelessProgrammableSwitch(name, subtype);
            svc.addOptionalCharacteristic(Characteristic.ConfiguredName);
            this.accessory.addService(svc);
        }
        else if (!svc.testCharacteristic(Characteristic.ConfiguredName)) {
            svc.addOptionalCharacteristic(Characteristic.ConfiguredName);
        }
        svc.displayName = name;
        svc.setCharacteristic(Characteristic.Name, name);
        svc.setCharacteristic(Characteristic.ConfiguredName, name);
        svc.setCharacteristic(Characteristic.ServiceLabelIndex, labelIndex);
        const eventChar = svc.getCharacteristic(Characteristic.ProgrammableSwitchEvent);
        eventChar.setProps({
            minValue: Math.min(...validValues),
            maxValue: Math.max(...validValues),
            validValues,
        });
        return svc;
    }
    ensureOccupancyService(subtype, name) {
        const { Service, Characteristic } = this.platform;
        let svc = this.accessory.getServiceById(Service.OccupancySensor, subtype);
        if (!svc) {
            svc = new Service.OccupancySensor(name, subtype);
            svc.addOptionalCharacteristic(Characteristic.ConfiguredName);
            this.accessory.addService(svc);
        }
        else if (!svc.testCharacteristic(Characteristic.ConfiguredName)) {
            svc.addOptionalCharacteristic(Characteristic.ConfiguredName);
        }
        svc.displayName = name;
        svc.setCharacteristic(Characteristic.Name, name);
        svc.setCharacteristic(Characteristic.ConfiguredName, name);
        const detectedChar = svc.getCharacteristic(Characteristic.OccupancyDetected);
        detectedChar.removeAllListeners('get');
        detectedChar.onGet(() => this.currentPowerState
            ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
            : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
        detectedChar.updateValue(this.currentPowerState
            ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
            : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
        return svc;
    }
    ensurePowerSwitchService(subtype, name, onPowerSwitchSet) {
        const { Service, Characteristic } = this.platform;
        let svc = this.accessory.getServiceById(Service.Switch, subtype);
        if (!svc) {
            svc = new Service.Switch(name, subtype);
            svc.addOptionalCharacteristic(Characteristic.ConfiguredName);
            this.accessory.addService(svc);
        }
        else if (!svc.testCharacteristic(Characteristic.ConfiguredName)) {
            svc.addOptionalCharacteristic(Characteristic.ConfiguredName);
        }
        svc.displayName = name;
        svc.setCharacteristic(Characteristic.Name, name);
        svc.setCharacteristic(Characteristic.ConfiguredName, name);
        const onChar = svc.getCharacteristic(Characteristic.On);
        onChar.removeAllListeners('get');
        onChar.removeAllListeners('set');
        onChar.onGet(() => Boolean(this.currentPowerState));
        onChar.onSet((value) => {
            const next = Boolean(value);
            this.currentPowerState = next;
            onPowerSwitchSet?.(next);
        });
        onChar.updateValue(Boolean(this.currentPowerState));
        return svc;
    }
    setPowerState(powered) {
        const { Characteristic } = this.platform;
        this.currentPowerState = powered;
        if (this.occupancyService) {
            this.occupancyService
                .getCharacteristic(Characteristic.OccupancyDetected)
                .updateValue(powered
                ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
                : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
        }
        if (this.powerSwitchService) {
            this.powerSwitchService
                .getCharacteristic(Characteristic.On)
                .updateValue(powered);
        }
    }
    triggerKeyEvent(key, pressType) {
        const { Characteristic } = this.platform;
        const hapValue = pressType === 'long'
            ? Characteristic.ProgrammableSwitchEvent.LONG_PRESS
            : Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS;
        if (key === 'volumeUp') {
            this.volumeUpService.getCharacteristic(Characteristic.ProgrammableSwitchEvent).updateValue(hapValue);
        }
        else if (key === 'volumeDown') {
            this.volumeDownService.getCharacteristic(Characteristic.ProgrammableSwitchEvent).updateValue(hapValue);
        }
        else if (key === 'mute') {
            this.muteService
                .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
                .updateValue(Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);
        }
        else if (key === 'powerOn' && this.powerOnService) {
            this.powerOnService
                .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
                .updateValue(Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);
        }
        else if (key === 'powerOff' && this.powerOffService) {
            this.powerOffService
                .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
                .updateValue(Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);
        }
    }
}
exports.Pulse8AppleTvAccessory = Pulse8AppleTvAccessory;
//# sourceMappingURL=platformAccessory.js.map