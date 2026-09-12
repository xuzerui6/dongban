import { Icon } from './Icons'

export function Header({ title, back, action }: { title: string; back?: () => void; action?: React.ReactNode }) {
  return <header className="page-header">{back ? <button className="icon-btn" onClick={back}><Icon name="back"/></button> : <div className="brand-mark">M</div>}<strong>{title}</strong><div className="header-action">{action}</div></header>
}
