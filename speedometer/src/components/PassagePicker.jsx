export default function PassagePicker({ passages, selectedIndex, onSelect }) {
  return (
    <div className="passage-picker">
      {passages.map((p, idx) => (
        <button
          key={p.title}
          type="button"
          className={`passage-chip${idx === selectedIndex ? ' active' : ''}`}
          aria-label={`Select paragraph: ${p.title}`}
          aria-pressed={idx === selectedIndex}
          onClick={() => onSelect(idx)}
        >
          {p.title}
        </button>
      ))}
    </div>
  );
}
