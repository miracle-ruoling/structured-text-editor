import { CircleHelp } from 'lucide-react';
import { useId } from 'react';

export function HelpTip({ text }: { text: string }) {
  const id = useId();
  return <span className="help-tip" tabIndex={0} role="note" aria-label="说明" aria-describedby={id}><CircleHelp size={13} /><span role="tooltip" id={id}>{text}</span></span>;
}
