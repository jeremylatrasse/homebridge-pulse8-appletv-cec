import { Service, PlatformAccessory } from 'homebridge';
import { Pulse8AppleTvCecPlatform } from './platform';
import { CecDiscoveredDevice, CecKeyType, CecPressType } from './cecClient';
import { AppleTvTrinnovOverride } from './trinnovClient';

export interface AppleTvFilterConfig extends AppleTvTrinnovOverride {
  name?: string;
  id?: string;
  logicalAddress?: string;
  physicalAddress?: string;
  osdName?: string;
  enabled?: boolean;
}

export function sanitizeHomeKitName(rawName: string, fallback = 'Apple TV'): string {
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
 * containing three StatelessProgrammableSwitch buttons:
 * 1. Volume Up (Single Press / Long Press)
 * 2. Volume Down (Single Press / Long Press)
 * 3. Mute (Single Press)
 */
export class Pulse8AppleTvAccessory {
  private readonly volumeUpService: Service;
  private readonly volumeDownService: Service;
  private readonly muteService: Service;

  constructor(
    private readonly platform: Pulse8AppleTvCecPlatform,
    private readonly accessory: PlatformAccessory,
    public readonly device: CecDiscoveredDevice,
    displayName: string,
    pluginVersion: string,
  ) {
    const { Service, Characteristic } = this.platform;
    const cleanName = sanitizeHomeKitName(displayName, 'Apple TV');

    // 1. Accessory Information
    const infoService = this.accessory.getService(Service.AccessoryInformation)!;
    infoService
      .setCharacteristic(Characteristic.Name, cleanName)
      .setCharacteristic(Characteristic.Manufacturer, 'Apple Inc.')
      .setCharacteristic(Characteristic.Model, 'Apple TV (Pulse-Eight CEC)')
      .setCharacteristic(
        Characteristic.SerialNumber,
        `CEC-${device.physicalAddress || device.logicalAddress.toUpperCase()}`,
      )
      .setCharacteristic(Characteristic.FirmwareRevision, pluginVersion);

    // 2. Service Label (required by HomeKit for multi-button StatelessProgrammableSwitch accessories)
    const labelService =
      this.accessory.getService(Service.ServiceLabel) ||
      this.accessory.addService(Service.ServiceLabel, `${cleanName} Buttons`, 'cec-buttons-label');
    labelService.setCharacteristic(
      Characteristic.ServiceLabelNamespace,
      Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS,
    );

    // 3. StatelessProgrammableSwitch buttons (Volume Up, Volume Down, Mute)
    const singleAndLong = [
      Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
      Characteristic.ProgrammableSwitchEvent.LONG_PRESS,
    ];
    const singleOnly = [Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS];

    this.volumeUpService = this.ensureSwitchService(
      'cec-volume-up',
      sanitizeHomeKitName(`${cleanName} Volume Up`, 'Volume Up'),
      1,
      singleAndLong,
    );

    this.volumeDownService = this.ensureSwitchService(
      'cec-volume-down',
      sanitizeHomeKitName(`${cleanName} Volume Down`, 'Volume Down'),
      2,
      singleAndLong,
    );

    this.muteService = this.ensureSwitchService(
      'cec-mute',
      sanitizeHomeKitName(`${cleanName} Mute`, 'Mute'),
      3,
      singleOnly,
    );
  }

  private ensureSwitchService(
    subtype: string,
    name: string,
    labelIndex: number,
    validValues: number[],
  ): Service {
    const { Service, Characteristic } = this.platform;

    let svc = this.accessory.getServiceById(Service.StatelessProgrammableSwitch, subtype);
    if (!svc) {
      svc = new Service.StatelessProgrammableSwitch(name, subtype);
      svc.addOptionalCharacteristic(Characteristic.ConfiguredName);
      this.accessory.addService(svc);
    } else if (!svc.testCharacteristic(Characteristic.ConfiguredName)) {
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

  public triggerKeyEvent(key: CecKeyType, pressType: CecPressType): void {
    const { Characteristic } = this.platform;
    const hapValue =
      pressType === 'long'
        ? Characteristic.ProgrammableSwitchEvent.LONG_PRESS
        : Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS;

    if (key === 'volumeUp') {
      this.volumeUpService.getCharacteristic(Characteristic.ProgrammableSwitchEvent).updateValue(hapValue);
    } else if (key === 'volumeDown') {
      this.volumeDownService.getCharacteristic(Characteristic.ProgrammableSwitchEvent).updateValue(hapValue);
    } else if (key === 'mute') {
      this.muteService
        .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
        .updateValue(Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);
    }
  }
}
