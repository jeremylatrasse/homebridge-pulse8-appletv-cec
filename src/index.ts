import { API } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { Pulse8AppleTvCecPlatform } from './platform';

/**
 * Entry point for Homebridge to load the plugin.
 */
export = (api: API) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, Pulse8AppleTvCecPlatform);
};
