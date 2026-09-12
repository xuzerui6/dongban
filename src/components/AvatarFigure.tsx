import { useStore } from '../lib/store'
import femaleFront from '../assets/female_front.png'
import femaleSide from '../assets/female_side.png'
import maleFront from '../assets/male_front.png'
import maleSide from '../assets/male_side.png'

export function AvatarFigure({ size = 'large', view = 'front' }: { size?: 'small' | 'large'; view?: 'front' | 'side' }) {
  const { state } = useStore()
  const images = state.gender === 'female'
    ? { front: femaleFront, side: femaleSide }
    : { front: maleFront, side: maleSide }
  const genderLabel = state.gender === 'female' ? '女性' : '男性'

  return <div className={`avatar-figure ${size}`}>
    <img className="pixel-art avatar-character" src={images[view]} alt={`${genderLabel}像素运动角色`} draggable={false}/>
  </div>
}
