import { useState } from 'react';

type Props = { label: string; value: string; options: string[]; onChange: (value: string) => void; placeholder?: string; maxLength?: number };

// Use the same native select as roles. Custom text is a separate, explicit mode;
// reopening the list never filters candidates by the previously selected value.
export function ChoiceInput({ label, value, options, onChange, placeholder = '请选择', maxLength = 100 }: Props) {
  const [custom, setCustom] = useState(false);
  const choices = [...new Set([...options, ...(value ? [value] : [])])];
  return <div className="choice-input">
    <select aria-label={label} value={custom ? 'custom' : value ? String(choices.indexOf(value)) : ''} onChange={e => {
      if (e.target.value === 'custom') setCustom(true);
      else { setCustom(false); onChange(e.target.value === '' ? '' : choices[Number(e.target.value)]); }
    }}>
      <option value="">{placeholder}</option>
      {choices.map((item, index) => <option key={item} value={String(index)}>{item}</option>)}
      <option value="custom">自定义…</option>
    </select>
    {custom && <input aria-label={`${label}自定义`} autoFocus value={value} placeholder="输入自定义值" maxLength={maxLength} onChange={e => onChange(e.target.value)} />}
  </div>;
}
