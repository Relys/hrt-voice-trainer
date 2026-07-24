export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

/** Labels are blank until a getUserMedia permission has been granted at least once. */
export async function listAudioInputDevices(): Promise<AudioInputDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d): d is MediaDeviceInfo => d.kind === "audioinput")
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}
