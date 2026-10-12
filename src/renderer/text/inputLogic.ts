export function textInputAction(event: { key: string; isComposing?: boolean; keyCode?: number }, composing: boolean): 'send' | 'cancel' | 'ignore' {
  if (composing || event.isComposing || event.keyCode === 229) return 'ignore';
  return event.key === 'Enter' ? 'send' : event.key === 'Escape' ? 'cancel' : 'ignore';
}
