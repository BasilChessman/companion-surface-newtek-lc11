module.exports = {
	forceRemoveNodeGypFromPkg: true,
	// serialport loads its native binary relative to its own package folder, so it can not be bundled
	// into main.js. Keep it external: the build installs it (with its prebuilt binaries for every
	// supported platform) next to main.js in the module package.
	externals: { serialport: 'commonjs serialport' },
}
