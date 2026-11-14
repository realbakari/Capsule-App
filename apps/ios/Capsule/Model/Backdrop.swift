import Foundation

/*
 * The conversation backdrop your computer's theme sets, as the phone reads it
 * from `configGetEffective` → `themes.backdrop.{light,dark}`. Only the five
 * built-in scenes are drawn here; images (`imageUrl`) are desktop-only.
 *
 * Mirrors `packages/shared/src/backdrop.ts`: the scene list, each scene's
 * ink (the most it mixes the text colour into the page), and the scrim that
 * keeps text readable over it.
 */
nonisolated struct Backdrop: Codable, Equatable, Sendable {
    enum Scene: String, Codable, CaseIterable, Sendable { case grain, mesh, night, dots, paper }

    var scene: Scene
    var opacity: Double
    var blur: Double
    var dim: Double

    /// The most each scene mixes the text colour into the page colour.
    static func ink(_ scene: Scene) -> Double {
        switch scene {
        case .grain: 0.10
        case .mesh: 0.14
        case .night: 0.16
        case .dots: 0.18
        case .paper: 0.08
        }
    }

    static let minContrast = 4.5

    /// How much of the page colour to lay over the backdrop: never less than `dim`,
    /// and enough that text over the scene's worst colour keeps 4.5:1 (or the bare
    /// page's own contrast, when the theme falls short of that).
    static func scrim(text: RGB, base: RGB, scene: Scene, opacity: Double, dim: Double) -> Double {
        let dim = min(1, max(0, dim))
        let target = min(minContrast, text.contrast(with: base))
        let sample = base.mixed(with: text, ink(scene))
        let shown = base.mixed(with: sample, min(1, max(0, opacity)))
        func readable(_ veil: Double) -> Bool { text.contrast(with: shown.mixed(with: base, veil)) >= target - 1e-9 }
        if readable(dim) { return dim }
        var low = dim, high = 1.0
        for _ in 0..<20 {
            let middle = (low + high) / 2
            if readable(middle) { high = middle } else { low = middle }
        }
        return (high * 100).rounded(.up) / 100
    }
}

/// Both appearances' backdrops, as the computer reports them.
nonisolated struct BackdropPair: Codable, Equatable, Sendable {
    var light: Backdrop?
    var dark: Backdrop?
}

/// The slice of the computer's config snapshot the phone reads. Everything else is ignored.
nonisolated struct ConfigSnapshotSlice: Decodable, Sendable {
    nonisolated struct Themes: Decodable, Sendable {
        nonisolated struct View: Decodable, Sendable {
            var scene: String?
            var opacity: Double?
            var blur: Double?
            var dim: Double?
            // `imageUrl` is a desktop-only scheme; deliberately not decoded.
        }
        nonisolated struct Pair: Decodable, Sendable { var light: View?; var dark: View? }
        var backdrop: Pair?
    }
    var themes: Themes?

    var backdrops: BackdropPair {
        func convert(_ view: Themes.View?) -> Backdrop? {
            guard let view, let scene = view.scene.flatMap(Backdrop.Scene.init(rawValue:)) else { return nil }
            return Backdrop(scene: scene, opacity: view.opacity ?? 1, blur: min(40, max(0, view.blur ?? 0)), dim: view.dim ?? 0)
        }
        return BackdropPair(light: convert(themes?.backdrop?.light), dark: convert(themes?.backdrop?.dark))
    }
}

/// An opaque colour in sRGB, for the readability maths.
nonisolated struct RGB: Equatable, Sendable {
    var r: Double, g: Double, b: Double

    func mixed(with other: RGB, _ amount: Double) -> RGB {
        RGB(r: r + (other.r - r) * amount, g: g + (other.g - g) * amount, b: b + (other.b - b) * amount)
    }

    var luminance: Double {
        func channel(_ c: Double) -> Double { c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }

    func contrast(with other: RGB) -> Double {
        let a = luminance, b = other.luminance
        return (max(a, b) + 0.05) / (min(a, b) + 0.05)
    }
}
