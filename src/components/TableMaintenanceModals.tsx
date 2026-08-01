import { CircleAlert, RefreshCw } from 'lucide-react'
import { Modal } from './Modal'

interface TableMaintenanceModalsProps {
  resetOpen: boolean
  newShoeOpen: boolean
  cardsRemaining: number
  onCloseReset: () => void
  onConfirmReset: () => void | Promise<void>
  onCloseNewShoe: () => void
  onConfirmNewShoe: () => void | Promise<void>
}

export function TableMaintenanceModals({
  resetOpen,
  newShoeOpen,
  cardsRemaining,
  onCloseReset,
  onConfirmReset,
  onCloseNewShoe,
  onConfirmNewShoe,
}: TableMaintenanceModalsProps) {
  return (
    <>
      {resetOpen && (
        <Modal title="重置全部本机模拟数据？" onClose={onCloseReset}>
          <div className="confirm-copy">
            <CircleAlert size={30} />
            <p>
              这会清除当前浏览器中的牌靴、最近 500 局记录和教学分余额，且无法撤销。
            </p>
            <div>
              <button className="secondary-button" onClick={onCloseReset}>
                取消
              </button>
              <button className="danger-button" onClick={onConfirmReset}>
                确认重置
              </button>
            </div>
          </div>
        </Modal>
      )}

      {newShoeOpen && (
        <Modal title="手动开启新牌靴？" onClose={onCloseNewShoe}>
          <div className="confirm-copy">
            <RefreshCw size={30} />
            <p>
              当前牌靴剩余 {cardsRemaining} 张。开启新牌靴会重置当前路单，但不会删除完整历史记录。
            </p>
            <div>
              <button className="secondary-button" onClick={onCloseNewShoe}>
                继续本靴
              </button>
              <button className="confirm-button" onClick={onConfirmNewShoe}>
                开启新牌靴
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
