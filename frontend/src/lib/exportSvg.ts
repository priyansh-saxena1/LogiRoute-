function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function serialize(svg: SVGSVGElement, width: number): { xml: string; height: number } {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const [, , vw, vh] = (svg.getAttribute('viewBox') ?? '0 0 1100 700').split(/\s+/).map(Number)
  const height = Math.round((width * vh) / vw)
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.removeAttribute('class')
  return { xml: new XMLSerializer().serializeToString(clone), height }
}

export function downloadSvg(svg: SVGSVGElement, filename: string) {
  const { xml } = serialize(svg, 1100)
  download(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }), filename)
}

export async function downloadPng(svg: SVGSVGElement, filename: string, width = 2200) {
  const { xml, height } = serialize(svg, width)
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (blob) download(blob, filename)
  } finally {
    URL.revokeObjectURL(url)
  }
}
