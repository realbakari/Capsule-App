import SwiftUI
import UIKit

/*
 * The five built-in scenes, drawn natively behind the transcript and composer.
 * Each follows `backdrop.css` on the desktop: the same marks, mixed from the
 * text colour (and for mesh and night, the theme's colours) at no more than
 * the scene's ink, so the readability scrim computed from that ink holds.
 * None animates.
 */
struct ConversationBackdrop: View {
    let backdrop: Backdrop
    @Environment(\.colorScheme) private var scheme
    @Environment(\.self) private var environment

    var body: some View {
        let text = rgb(Color.textPrimary)
        let base = rgb(Color.screen)
        let veil = Backdrop.scrim(text: text, base: base, scene: backdrop.scene, opacity: backdrop.opacity, dim: backdrop.dim)
        ZStack {
            Color.screen
            SceneLayer(scene: backdrop.scene)
                .opacity(backdrop.opacity)
                .blur(radius: backdrop.blur)
                .padding(-backdrop.blur * 2)
            Color.screen.opacity(veil)
        }
        .clipped()
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func rgb(_ color: Color) -> RGB {
        let resolved = color.resolve(in: environment)
        return RGB(r: Double(resolved.red), g: Double(resolved.green), b: Double(resolved.blue))
    }
}

private struct SceneLayer: View {
    let scene: Backdrop.Scene

    var body: some View {
        switch scene {
        case .grain: NoiseTile(kind: .grain).foregroundStyle(Color.textPrimary.opacity(0.10))
        case .paper: NoiseTile(kind: .paper).foregroundStyle(Color.textPrimary.opacity(0.08))
        case .mesh: Mesh()
        case .night: Night()
        case .dots: Dots()
        }
    }
}

/// Four soft colour pools in the corners.
private struct Mesh: View {
    var body: some View {
        GeometryReader { proxy in
            let w = proxy.size.width, h = proxy.size.height
            ZStack {
                pool(Color.attention, 0.14, at: CGPoint(x: 0.12 * w, y: 0.08 * h), rx: 0.6 * w, ry: 0.5 * h)
                pool(Color.unreadDot, 0.13, at: CGPoint(x: 0.88 * w, y: 0.18 * h), rx: 0.55 * w, ry: 0.45 * h)
                pool(Color.success, 0.11, at: CGPoint(x: 0.70 * w, y: 0.92 * h), rx: 0.6 * w, ry: 0.55 * h)
                pool(Color(red: 0.95, green: 0.75, blue: 0.2), 0.09, at: CGPoint(x: 0.18 * w, y: 0.85 * h), rx: 0.5 * w, ry: 0.45 * h)
            }
        }
    }

    private func pool(_ color: Color, _ amount: Double, at center: CGPoint, rx: CGFloat, ry: CGFloat) -> some View {
        Ellipse()
            .fill(RadialGradient(colors: [color.opacity(amount), color.opacity(0)], center: .center, startRadius: 0, endRadius: max(rx, ry) * 0.7))
            .frame(width: rx * 2, height: ry * 2)
            .position(center)
    }
}

/// A faint star field over a blue wash at the top.
private struct Night: View {
    private static let stars: [(x: CGFloat, y: CGFloat, r: CGFloat, a: Double)] = [
        (0.12, 0.18, 1, 0.16), (0.68, 0.09, 1, 0.14), (0.84, 0.31, 1.5, 0.16), (0.37, 0.42, 1, 0.12),
        (0.22, 0.66, 1, 0.14), (0.58, 0.74, 1.5, 0.12), (0.91, 0.83, 1, 0.14),
    ]

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color.unreadDot.opacity(0.12), .clear], startPoint: .top, endPoint: UnitPoint(x: 0.5, y: 0.75))
            Canvas { context, size in
                let tile: CGFloat = 320
                var y: CGFloat = 0
                while y < size.height {
                    var x: CGFloat = 0
                    while x < size.width {
                        for star in Self.stars {
                            let rect = CGRect(x: x + star.x * tile - star.r, y: y + star.y * tile - star.r, width: star.r * 2, height: star.r * 2)
                            context.fill(Path(ellipseIn: rect), with: .color(Color.textPrimary.opacity(star.a)))
                        }
                        x += tile
                    }
                    y += tile
                }
            }
        }
    }
}

/// A 22-point grid of 1-point dots.
private struct Dots: View {
    var body: some View {
        Canvas { context, size in
            let step: CGFloat = 22
            var path = Path()
            var y: CGFloat = 0
            while y < size.height + step {
                var x: CGFloat = 0
                while x < size.width + step {
                    path.addEllipse(in: CGRect(x: x - 1, y: y - 1, width: 2, height: 2))
                    x += step
                }
                y += step
            }
            context.fill(path, with: .color(Color.textPrimary.opacity(0.18)))
        }
    }
}

/// Grain and paper: a noise mask tiled across, coloured by the foreground style.
private struct NoiseTile: View {
    enum Kind { case grain, paper }
    let kind: Kind

    var body: some View {
        Rectangle()
            .mask {
                Rectangle().fill(ImagePaint(image: Image(uiImage: NoiseImage.tile(kind == .grain ? .grain : .paper)), scale: 1))
            }
    }
}

/// Deterministic noise tiles, built once: grain is fine and even, paper is long horizontal fibres.
private enum NoiseImage {
    enum Kind { case grain, paper }
    @MainActor private static var cache: [Kind: UIImage] = [:]

    @MainActor static func tile(_ kind: Kind) -> UIImage {
        if let hit = cache[kind] { return hit }
        let image = make(kind)
        cache[kind] = image
        return image
    }

    private static func make(_ kind: Kind) -> UIImage {
        let side = kind == .grain ? 180 : 260
        var seed: UInt64 = kind == .grain ? 0x9E3779B97F4A7C15 : 0xD1B54A32D192ED03
        func next() -> Double {
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            return Double(seed >> 33) / Double(1 << 31)
        }
        // Value noise on a coarse lattice, smoothly interpolated. Paper stretches it along x.
        let cellsX = kind == .grain ? 90 : 4, cellsY = kind == .grain ? 90 : 96
        var lattice = [[Double]](repeating: [Double](repeating: 0, count: cellsX + 1), count: cellsY + 1)
        for y in 0...cellsY { for x in 0...cellsX { lattice[y][x] = next() } }
        for y in 0...cellsY { lattice[y][cellsX] = lattice[y][0] }
        for x in 0...cellsX { lattice[cellsY][x] = lattice[0][x] }
        // White with the noise as alpha, premultiplied; the mask reads only the alpha.
        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        for py in 0..<side {
            let fy = Double(py) / Double(side) * Double(cellsY)
            let y0 = Int(fy), ty = fy - Double(y0), sy = ty * ty * (3 - 2 * ty)
            for px in 0..<side {
                let fx = Double(px) / Double(side) * Double(cellsX)
                let x0 = Int(fx), tx = fx - Double(x0), sx = tx * tx * (3 - 2 * tx)
                let top = lattice[y0][x0] + (lattice[y0][x0 + 1] - lattice[y0][x0]) * sx
                let bottom = lattice[y0 + 1][x0] + (lattice[y0 + 1][x0 + 1] - lattice[y0 + 1][x0]) * sx
                var v = top + (bottom - top) * sy
                if kind == .grain { v = v * 0.6 + next() * 0.4 }
                // The desktop's colour matrix: a steep ramp, so only the top of the noise shows.
                let a = UInt8(max(0, min(1, kind == .grain ? (1.4 * v - 0.45) : (2.2 * v - 0.9))) * 255)
                let i = (py * side + px) * 4
                pixels[i] = a; pixels[i + 1] = a; pixels[i + 2] = a; pixels[i + 3] = a
            }
        }
        guard let provider = CGDataProvider(data: Data(pixels) as CFData),
              let cg = CGImage(width: side, height: side, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: side * 4,
                               space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                               provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
        else { return UIImage() }
        return UIImage(cgImage: cg, scale: 1, orientation: .up)
    }
}

#Preview {
    ScrollView {
        VStack(spacing: 12) {
            ForEach(Backdrop.Scene.allCases, id: \.self) { scene in
                ConversationBackdrop(backdrop: Backdrop(scene: scene, opacity: 1, blur: 0, dim: 0))
                    .frame(height: 160)
                    .overlay(Text(scene.rawValue).font(.headline))
                    .clipShape(.rect(cornerRadius: 12))
            }
        }
        .padding()
    }
}
