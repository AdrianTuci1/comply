using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Comply.Functions.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddEvidenceCitationAndHash : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "citation",
                table: "evidence",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "hash",
                table: "evidence",
                type: "text",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_assessment_requirements_assessment_library_requirement",
                table: "assessment_requirements",
                columns: new[] { "assessment_id", "library_requirement_id" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_assessment_requirements_assessment_library_requirement",
                table: "assessment_requirements");

            migrationBuilder.DropColumn(
                name: "citation",
                table: "evidence");

            migrationBuilder.DropColumn(
                name: "hash",
                table: "evidence");
        }
    }
}
