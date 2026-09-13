import { useStore } from '../lib/store'
import { getOutfitAvatar, outfitLabels } from '../lib/outfits'
import type { AvatarView, OutfitPreset } from '../types'

export function AvatarFigure({ size = 'large', view = 'front', outfit }: { size?: 'small' | 'large'; view?: AvatarView; outfit?: OutfitPreset }) {
  const { state } = useStore()
  const displayedOutfit = outfit || state.activeOutfit
  const image = getOutfitAvatar(state.avatarGender, displayedOutfit, view)
  const genderLabel = state.avatarGender === 'female' ? '女性' : '男性'

  return <div className={`avatar-figure ${size}`}>
    <img className="pixel-art avatar-character" src={image} alt={`${genderLabel}${outfitLabels[displayedOutfit]}角色`} draggable={false}/>
  </div>
}
