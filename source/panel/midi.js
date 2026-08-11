// Web MIDI plumbing. The panel is an extension page, so the permission
// grant is per-extension-origin and persists in the kiosk profile — grant
// it once while building the template profile.

export async function initMIDI({ onCC, onStatus }) {
  if (!navigator.requestMIDIAccess) {
    onStatus('Web MIDI unavailable');
    return;
  }
  let access;
  try {
    access = await navigator.requestMIDIAccess();
  } catch {
    onStatus('MIDI permission denied');
    return;
  }

  const attach = () => {
    const names = [];
    for (const input of access.inputs.values()) {
      names.push(input.name);
      input.onmidimessage = (msg) => {
        const [status, data1, data2] = msg.data;
        if ((status & 0xf0) === 0xb0) onCC(data1, data2); // control change
      };
    }
    onStatus(names.length ? names.join(', ') : 'no device');
  };

  access.onstatechange = attach;
  attach();
}
